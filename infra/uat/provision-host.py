"""Run in the authenticated AWS CloudShell after approval of the UAT SSH key."""
import base64
import hashlib
import ipaddress
import json
import pathlib
import sys
import boto3

target = json.loads(pathlib.Path(sys.argv[1]).read_text())
network = ipaddress.ip_network(target['ssh_cidr'], strict=True)
if network.version != 4 or network.prefixlen != 32 or not network.network_address.is_global:
    raise RuntimeError('SSH must be limited to one public IPv4 address')
if not target['public_key'].startswith('ssh-rsa '):
    raise RuntimeError('Lightsail requires an RSA public key')
account = boto3.client('sts').get_caller_identity()['Account']
if account != '434793037720':
    raise RuntimeError('Wrong AWS account')
client = boto3.client('lightsail', region_name='eu-central-1')
name = 'vanly-uat'
key_name = 'vanly-uat-deploy'
bundle = next(item for item in client.get_bundles()['bundles']
              if item['bundleId'] == 'medium_3_0' and item['isActive'])
if float(bundle['price']) != 24 or bundle['ramSizeInGb'] != 4:
    raise RuntimeError('The approved UAT bundle or price changed')
blueprint = next(item for item in client.get_blueprints()['blueprints']
                 if item['blueprintId'] == 'ubuntu_24_04' and item['isActive'])
key_marker = pathlib.Path('vanly-uat-key-import.json')
key_hash = hashlib.sha256(target['public_key'].encode()).hexdigest()
keys = {key['name']: key for key in client.get_key_pairs()['keyPairs']}
if key_name not in keys:
    client.import_key_pair(keyPairName=key_name,
                           publicKeyBase64=target['public_key'].strip())
    imported = client.get_key_pair(keyPairName=key_name)['keyPair']
    key_marker.write_text(json.dumps({'public_key_hash': key_hash, 'fingerprint': imported['fingerprint']}))
else:
    if not key_marker.exists():
        raise RuntimeError('Existing SSH key has no import receipt; verify before continuing')
    receipt = json.loads(key_marker.read_text())
    if receipt['public_key_hash'] != key_hash or receipt['fingerprint'] != keys[key_name]['fingerprint']:
        raise RuntimeError('Existing SSH key does not match this UAT deployment')
instances = {instance['name']: instance for instance in client.get_instances()['instances']}
if name not in instances:
    client.create_instances(instanceNames=[name], availabilityZone='eu-central-1a',
        blueprintId=blueprint['blueprintId'], bundleId='medium_3_0', keyPairName=key_name,
        tags=[{'key': 'Project', 'value': 'VANLY'}, {'key': 'Environment', 'value': 'UAT'}])
    print(json.dumps({'name': name, 'phase': 'creating', 'ready': False,
                      'next': 'Read instance state, then rerun this same script; do not create another instance'}))
    sys.exit(0)
instance = instances[name]
tags = {tag['key']: tag['value'] for tag in instance.get('tags', [])}
if tags.get('Project') != 'VANLY' or tags.get('Environment') != 'UAT' or instance['bundleId'] != 'medium_3_0':
    raise RuntimeError('Existing instance is not the prepared VANLY UAT host')
if instance['state']['name'] != 'running':
    print(json.dumps({'name': name, 'phase': instance['state']['name'], 'ready': False}))
    sys.exit(0)
client.put_instance_public_ports(instanceName=name, portInfos=[
    {'fromPort': 22, 'toPort': 22, 'protocol': 'tcp', 'cidrs': [target['ssh_cidr']]},
    {'fromPort': 80, 'toPort': 80, 'protocol': 'tcp', 'cidrs': ['0.0.0.0/0']},
    {'fromPort': 443, 'toPort': 443, 'protocol': 'tcp', 'cidrs': ['0.0.0.0/0']},
])
ips = {ip['name']: ip for ip in client.get_static_ips()['staticIps']}
if 'vanly-uat-ip' not in ips:
    client.allocate_static_ip(staticIpName='vanly-uat-ip')
ip = client.get_static_ip(staticIpName='vanly-uat-ip')['staticIp']
if not ip.get('isAttached'):
    client.attach_static_ip(staticIpName='vanly-uat-ip', instanceName=name)
elif ip.get('attachedTo') != name:
    raise RuntimeError('Static IP belongs to another instance')
record = {'Name': 'origin.uat.vanly.me.', 'Type': 'A', 'TTL': 60,
          'ResourceRecords': [{'Value': ip['ipAddress']}]}
r53 = boto3.client('route53')
existing = r53.list_resource_record_sets(HostedZoneId='Z075191742DMTSFOW6RO',
    StartRecordName=record['Name'], StartRecordType='A', MaxItems='1')['ResourceRecordSets']
if existing and existing[0]['Name'] == record['Name'] and existing[0] != record:
    raise RuntimeError('Existing origin DNS must be reviewed before changing it')
if not existing or existing[0]['Name'] != record['Name']:
    r53.change_resource_record_sets(HostedZoneId='Z075191742DMTSFOW6RO',
        ChangeBatch={'Comment': 'VANLY UAT origin only', 'Changes': [{'Action': 'CREATE', 'ResourceRecordSet': record}]})
print(json.dumps({'name': name, 'phase': 'configured', 'ready': True,
                  'ip': ip['ipAddress'], 'bundle': 'medium_3_0', 'monthly_usd': 24,
                  'ssh_cidr': target['ssh_cidr'], 'origin': 'origin.uat.vanly.me'}))
