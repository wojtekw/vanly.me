"""Run with the existing account session in AWS CloudShell; UAT resources only."""
import hashlib
import json
import pathlib
import re
import sys
import time
import boto3
from botocore.exceptions import ClientError

ACCOUNT = '434793037720'
ZONE = 'Z075191742DMTSFOW6RO'
HOSTS = ['uat.vanly.me', 'owner.uat.vanly.me', 'admin.uat.vanly.me']
FUNCTION = 'vanly-uat-viewer-host'
COMMENT = 'VANLY UAT — portal, owner and admin'
TAGS = [{'Key': 'Project', 'Value': 'VANLY'}, {'Key': 'Environment', 'Value': 'UAT'}]
state_path = pathlib.Path('vanly-uat-edge-state.json')
state = json.loads(state_path.read_text()) if state_path.exists() else {}
if boto3.client('sts').get_caller_identity()['Account'] != ACCOUNT:
    raise RuntimeError('Wrong AWS account')
acm = boto3.client('acm', region_name='us-east-1')
r53 = boto3.client('route53')
cf = boto3.client('cloudfront')

def save():
    state_path.write_text(json.dumps(state, indent=2))
    state_path.chmod(0o600)

def record_create_only(record):
    rows = r53.list_resource_record_sets(HostedZoneId=ZONE, StartRecordName=record['Name'],
        StartRecordType=record['Type'], MaxItems='1')['ResourceRecordSets']
    if rows and rows[0]['Name'].rstrip('.') == record['Name'].rstrip('.') and rows[0]['Type'] == record['Type']:
        if rows[0].get('ResourceRecords') != record.get('ResourceRecords'):
            raise RuntimeError('Existing DNS record differs: ' + record['Name'])
        return
    r53.change_resource_record_sets(HostedZoneId=ZONE, ChangeBatch={'Comment': 'VANLY UAT only',
        'Changes': [{'Action': 'CREATE', 'ResourceRecordSet': record}]})

if sys.argv[1] == 'certificate':
    if not state.get('certificate_arn'):
        for page in acm.get_paginator('list_certificates').paginate():
            for item in page['CertificateSummaryList']:
                if item['DomainName'] != HOSTS[0]:
                    continue
                certificate = acm.describe_certificate(CertificateArn=item['CertificateArn'])['Certificate']
                if set(certificate['SubjectAlternativeNames']) != set(HOSTS):
                    continue
                tags = acm.list_tags_for_certificate(CertificateArn=item['CertificateArn'])['Tags']
                if not all(tag in tags for tag in TAGS):
                    raise RuntimeError('Matching certificate is not tagged for this UAT')
                state['certificate_arn'] = item['CertificateArn']
                save()
        if not state.get('certificate_arn'):
            result = acm.request_certificate(DomainName=HOSTS[0], SubjectAlternativeNames=HOSTS[1:],
                ValidationMethod='DNS', IdempotencyToken='vanlyuat20261009', Tags=TAGS)
            state['certificate_arn'] = result['CertificateArn']
            save()
    certificate = acm.describe_certificate(CertificateArn=state['certificate_arn'])['Certificate']
    records = {item['ResourceRecord']['Name']: item['ResourceRecord']
        for item in certificate.get('DomainValidationOptions', []) if item.get('ResourceRecord')}
    for item in records.values():
        record_create_only({'Name': item['Name'], 'Type': item['Type'], 'TTL': 60,
            'ResourceRecords': [{'Value': item['Value']}]})
    print(json.dumps({'certificate': state['certificate_arn'], 'status': certificate['Status'],
        'validation_records': len(records), 'hosts': HOSTS}))
    sys.exit(0)

if sys.argv[1] == 'distribution':
    certificate = acm.describe_certificate(CertificateArn=state['certificate_arn'])['Certificate']
    if certificate['Status'] != 'ISSUED':
        print(json.dumps({'ready': False, 'certificate_status': certificate['Status']}))
        sys.exit(0)
    secret = pathlib.Path(sys.argv[2]).read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}', secret):
        raise RuntimeError('Invalid origin secret')
    code = pathlib.Path('vanly-uat-provision/viewer-host.js').read_bytes()
    try:
        function = cf.describe_function(Name=FUNCTION, Stage='DEVELOPMENT')
        current = cf.get_function(Name=FUNCTION, Stage='DEVELOPMENT')['FunctionCode'].read()
        if current != code:
            raise RuntimeError('Existing CloudFront function differs; refusing overwrite')
    except ClientError as error:
        if error.response['Error']['Code'] != 'NoSuchFunctionExists':
            raise
        function = cf.create_function(Name=FUNCTION, FunctionConfig={'Comment': 'VANLY UAT host routing',
            'Runtime': 'cloudfront-js-2.0'}, FunctionCode=code)
    published = cf.publish_function(Name=FUNCTION, IfMatch=function['ETag'])
    arn = published['FunctionSummary']['FunctionMetadata']['FunctionARN']
    cache_policy = next(item['CachePolicy']['Id'] for item in cf.list_cache_policies(Type='managed')['CachePolicyList']['Items']
        if item['CachePolicy']['CachePolicyConfig']['Name'].endswith('CachingDisabled'))
    origin_policy = next(item['OriginRequestPolicy']['Id'] for item in cf.list_origin_request_policies(Type='managed')['OriginRequestPolicyList']['Items']
        if item['OriginRequestPolicy']['OriginRequestPolicyConfig']['Name'].endswith('AllViewerExceptHostHeader'))
    if not state.get('distribution_id'):
        for page in cf.get_paginator('list_distributions').paginate():
            for item in page['DistributionList'].get('Items', []):
                aliases = set(item.get('Aliases', {}).get('Items', []))
                if aliases.intersection(HOSTS):
                    if aliases != set(HOSTS) or item['Comment'] != COMMENT:
                        raise RuntimeError('UAT aliases belong to another distribution')
                    state['distribution_id'] = item['Id']
                    save()
    if not state.get('distribution_id'):
        origin = {'Id': 'VanlyUATOrigin', 'DomainName': 'origin.uat.vanly.me', 'OriginPath': '',
            'CustomHeaders': {'Quantity': 1, 'Items': [{'HeaderName': 'X-Vanly-Origin', 'HeaderValue': secret}]},
            'CustomOriginConfig': {'HTTPPort': 80, 'HTTPSPort': 443, 'OriginProtocolPolicy': 'https-only',
                'OriginSslProtocols': {'Quantity': 1, 'Items': ['TLSv1.2']},
                'OriginReadTimeout': 60, 'OriginKeepaliveTimeout': 5}}
        behavior = {'TargetOriginId': 'VanlyUATOrigin', 'ViewerProtocolPolicy': 'redirect-to-https',
            'AllowedMethods': {'Quantity': 7, 'Items': ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
                'CachedMethods': {'Quantity': 2, 'Items': ['GET', 'HEAD']}},
            'CachePolicyId': cache_policy, 'OriginRequestPolicyId': origin_policy, 'Compress': True,
            'TrustedSigners': {'Enabled': False, 'Quantity': 0},
            'FunctionAssociations': {'Quantity': 1, 'Items': [{'FunctionARN': arn, 'EventType': 'viewer-request'}]}}
        config = {'CallerReference': 'vanly-uat-20261009', 'Comment': COMMENT, 'Enabled': True,
            'Aliases': {'Quantity': 3, 'Items': HOSTS}, 'Origins': {'Quantity': 1, 'Items': [origin]},
            'DefaultCacheBehavior': behavior, 'PriceClass': 'PriceClass_100', 'HttpVersion': 'http2', 'IsIPV6Enabled': True,
            'ViewerCertificate': {'ACMCertificateArn': state['certificate_arn'], 'SSLSupportMethod': 'sni-only',
                'MinimumProtocolVersion': 'TLSv1.2_2021'},
            'Restrictions': {'GeoRestriction': {'RestrictionType': 'none', 'Quantity': 0}}}
        result = cf.create_distribution_with_tags(DistributionConfigWithTags={'DistributionConfig': config,
            'Tags': {'Items': TAGS}})['Distribution']
        state['distribution_id'] = result['Id']
        save()
    distribution = cf.get_distribution(Id=state['distribution_id'])['Distribution']
    config = distribution['DistributionConfig']
    if set(config['Aliases']['Items']) != set(HOSTS) or config['Comment'] != COMMENT:
        raise RuntimeError('Distribution does not match this UAT')
    state['distribution_domain'] = distribution['DomainName']
    state['status'] = distribution['Status']
    save()
    print(json.dumps({'distribution_id': distribution['Id'], 'domain': distribution['DomainName'],
        'status': distribution['Status'], 'cache_disabled': cache_policy,
        'origin_policy': origin_policy, 'function': arn}))
    sys.exit(0)

if sys.argv[1] == 'dns':
    distribution = cf.get_distribution(Id=state['distribution_id'])['Distribution']
    if distribution['Status'] != 'Deployed':
        print(json.dumps({'ready': False, 'distribution_status': distribution['Status']}))
        sys.exit(0)
    for host in HOSTS:
        record_create_only({'Name': host + '.', 'Type': 'CNAME', 'TTL': 60,
            'ResourceRecords': [{'Value': distribution['DomainName']}]})
    state['dns_published'] = True
    save()
    print(json.dumps({'ready': True, 'distribution_id': distribution['Id'], 'hosts': HOSTS}))
    sys.exit(0)
raise RuntimeError('Unknown action')
