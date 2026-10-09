#!/usr/bin/env python3
"""Small, account-scoped static publisher. No resource creation, DNS or IAM writes.

Manifest is fully offline. Verify is read-only. Publish/rollback explicitly mutate
only the supplied Vanly bucket and invalidate the supplied Vanly distribution.
"""
import argparse
import hashlib
import json
import mimetypes
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / '.local' / 'coming-soon'
ALLOWED_SUFFIXES = {'.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.txt', '.xml', '.json'}


def fail(message):
    raise RuntimeError(message)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def save_audit(name, value):
    AUDIT.mkdir(parents=True, exist_ok=True)
    path = AUDIT / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + '\n')
    path.chmod(0o600)
    return path


def manifest(source):
    source = Path(source).resolve()
    if not (source / 'index.html').is_file():
        fail('The asset directory must contain index.html.')
    entries = []
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        key = path.relative_to(source).as_posix()
        if path.is_symlink() or any(part.startswith('.') for part in Path(key).parts):
            fail(f'Hidden files and symlinks cannot be published: {key}')
        # The source directory contains authoring instructions; these are not public assets.
        if key == 'README.md':
            continue
        if path.suffix.lower() not in ALLOWED_SUFFIXES:
            fail(f'Unsupported public asset type: {key}')
        data = path.read_bytes()
        entries.append({'key': key, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    total = sum(e['bytes'] for e in entries)
    if len(entries) > 200 or total > 20 * 1024 * 1024:
        fail('Coming-soon asset budget exceeded (200 files / 20 MiB).')
    digest = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    return {'source': str(source), 'files': entries, 'totalBytes': total, 'sha256': digest}


def aws_clients(args):
    import boto3
    from botocore.config import Config
    target = json.loads(Path(args.target).read_text())
    if target.get('accountId') != '434793037720':
        fail('Target must be the verified Vanly AWS account 434793037720.')
    if not target.get('bucket', '').startswith('vanly-'):
        fail('Only a dedicated bucket whose name starts with vanly- is allowed.')
    if not args.profile and not args.use_environment:
        fail('Choose --profile explicitly, or --use-environment for a configured credential chain.')
    session = boto3.Session(profile_name=args.profile, region_name='us-east-1')
    cfg = Config(connect_timeout=8, read_timeout=20, retries={'mode': 'standard', 'max_attempts': 2})
    identity = session.client('sts', config=cfg).get_caller_identity()
    if identity['Account'] != target['accountId']:
        fail('Authenticated AWS account does not match target account.')
    clients = {
        's3': session.client('s3', region_name=target.get('bucketRegion', 'us-east-1'), config=cfg),
        'cf': session.client('cloudfront', config=cfg),
        'ppm': session.client('pricing-plan-manager', config=cfg),
        'r53': session.client('route53', config=cfg),
        'acm': session.client('acm', config=cfg),
    }
    return target, clients, identity


def verify(target, clients, identity):
    s3, cf = clients['s3'], clients['cf']
    bucket = target['bucket']
    cf_result = cf.get_distribution(Id=target['distributionId'])['Distribution']
    aliases = cf_result['DistributionConfig'].get('Aliases', {}).get('Items', [])
    if set(aliases) != {'vanly.me', 'www.vanly.me'}:
        fail('Distribution must contain exactly the two Vanly domain aliases.')
    origins = cf_result['DistributionConfig']['Origins'].get('Items', [])
    if not any(o['DomainName'].startswith(bucket + '.') and o.get('OriginAccessControlId') for o in origins):
        fail('Distribution is not using the target S3 bucket with OAC.')
    block = s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
    if not all(block.get(k) for k in ['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']):
        fail('All four S3 public access protections must be enabled.')
    if s3.get_bucket_policy_status(Bucket=bucket)['PolicyStatus']['IsPublic']:
        fail('Bucket policy is public.')
    if s3.get_bucket_versioning(Bucket=bucket).get('Status') != 'Enabled':
        fail('S3 versioning must be enabled before publishing (required for rollback).')
    plan = clients['ppm'].get_subscription(arn=target['subscriptionArn'])['subscription']
    if plan['status'] != 'ACTIVE' or plan['planTier'] != 'FREE':
        fail('An ACTIVE CloudFront FREE plan is required; no PAYG/paid fallback is allowed.')
    resources = plan.get('resourceArns', [])
    if cf_result['ARN'] not in resources:
        fail('FREE subscription is not attached to the supplied distribution.')
    waf = cf_result['DistributionConfig'].get('WebACLId')
    if not waf or waf not in resources:
        fail('The distribution WAF must be attached to the FREE subscription.')
    zone_info = None
    if target.get('hostedZoneId'):
        zone_id = target['hostedZoneId'].removeprefix('/hostedzone/')
        zone_arn = f'arn:aws:route53:::hostedzone/{zone_id}'
        if zone_arn not in resources:
            fail('Route53 zone is not attached to the FREE subscription.')
        zone = clients['r53'].get_hosted_zone(Id=zone_id)
        if zone['HostedZone']['Name'] != 'vanly.me.' or zone['HostedZone']['Config']['PrivateZone']:
            fail('Target hosted zone must be public and named vanly.me.')
        zone_info = {'id': zone_id, 'nameservers': zone['DelegationSet']['NameServers']}
    certificate = cf_result['DistributionConfig']['ViewerCertificate'].get('ACMCertificateArn')
    if not certificate or certificate.split(':')[3] != 'us-east-1':
        fail('CloudFront must use an ACM certificate in us-east-1.')
    cert = clients['acm'].describe_certificate(CertificateArn=certificate)['Certificate']
    if cert['Status'] != 'ISSUED' or not {'vanly.me', 'www.vanly.me'}.issubset(set(cert['SubjectAlternativeNames'])):
        fail('ACM certificate must be ISSUED and cover both Vanly names.')
    report = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'accountId': identity['Account'],
              'principal': identity['Arn'], 'bucket': bucket, 'distributionId': target['distributionId'],
              'distributionDomain': cf_result['DomainName'], 'distributionStatus': cf_result['Status'],
              'enabled': cf_result['DistributionConfig']['Enabled'], 'planTier': plan['planTier'],
              'planStatus': plan['status'], 'hostedZone': zone_info, 'certificateArn': certificate,
              'costNote': 'FREE plan is not an account-wide spending cap. S3 requests and other account services may be billed.'}
    save_audit('last-verification.json', report)
    return report


def head(s3, bucket, key):
    from botocore.exceptions import ClientError
    try:
        return s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response['Error']['Code'] in {'404', 'NoSuchKey', 'NotFound'}:
            return None
        raise


def invalidate(clients, target, caller):
    return clients['cf'].create_invalidation(DistributionId=target['distributionId'],
        InvalidationBatch={'Paths': {'Quantity': 1, 'Items': ['/*']}, 'CallerReference': caller})['Invalidation']['Id']


def publish(args, target, clients):
    files = manifest(args.assets)
    before = []
    for entry in files['files']:
        old = head(clients['s3'], target['bucket'], entry['key'])
        before.append({'key': entry['key'], 'versionId': old.get('VersionId') if old else None,
                       'etag': old.get('ETag') if old else None})
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    record = {'target': target, 'releaseSha256': files['sha256'], 'createdAt': stamp, 'before': before, 'uploaded': []}
    record_name = f'release-{stamp}-{files["sha256"][:12]}.json'
    backup = save_audit(record_name, record)
    # Upload referenced assets first; make index.html the final write.
    for entry in sorted(files['files'], key=lambda e: e['key'] == 'index.html'):
        key = entry['key']
        old = head(clients['s3'], target['bucket'], key)
        if old and old.get('Metadata', {}).get('sha256') == entry['sha256']:
            continue
        data = (Path(files['source']) / key).read_bytes()
        # Explicit script MIME avoids platform-dependent guesses and nosniff failures.
        mime = 'text/javascript' if Path(key).suffix.lower() == '.js' else (mimetypes.guess_type(key)[0] or 'application/octet-stream')
        if mime.startswith('text/') or key.endswith('.js'):
            mime += '; charset=utf-8'
        result = clients['s3'].put_object(Bucket=target['bucket'], Key=key, Body=data,
            ContentType=mime, CacheControl='public, max-age=300', Metadata={'sha256': entry['sha256']})
        record['uploaded'].append({'key': key, 'versionId': result.get('VersionId')})
        save_audit(record_name, record)
    if record['uploaded']:
        record['invalidationId'] = invalidate(clients, target, f'vanly-{files["sha256"]}-{stamp}')
        save_audit(record_name, record)
    return {'uploadedFiles': len(record['uploaded']), 'releaseSha256': files['sha256'],
            'rollbackRecord': str(backup), 'invalidationId': record.get('invalidationId')}


def rollback(args, target, clients):
    record = json.loads(Path(args.record).read_text())
    if record['target'] != target:
        fail('Rollback target differs from the saved release target.')
    uploaded_keys = {e['key'] for e in record.get('uploaded', [])}
    restored = []
    for item in sorted(record['before'], key=lambda e: e['key'] == 'index.html'):
        if item['key'] not in uploaded_keys:
            continue
        current = head(clients['s3'], target['bucket'], item['key'])
        if item['versionId'] is None:
            if current:
                clients['s3'].delete_object(Bucket=target['bucket'], Key=item['key'])
                restored.append(item['key'])
        elif not current or current.get('ETag') != item['etag']:
            clients['s3'].copy_object(Bucket=target['bucket'], Key=item['key'],
                CopySource={'Bucket': target['bucket'], 'Key': item['key'], 'VersionId': item['versionId']},
                MetadataDirective='COPY')
            restored.append(item['key'])
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    invalidation = invalidate(clients, target, f'vanly-rollback-{stamp}') if restored else None
    save_audit(f'rollback-{stamp}.json', {'record': args.record, 'restored': restored, 'invalidationId': invalidation})
    return {'restored': restored, 'invalidationId': invalidation}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['manifest', 'verify', 'publish', 'rollback'])
    parser.add_argument('--assets', default=str(ROOT / 'apps' / 'coming-soon'))
    parser.add_argument('--target')
    parser.add_argument('--profile')
    parser.add_argument('--use-environment', action='store_true')
    parser.add_argument('--record')
    args = parser.parse_args()
    if args.action == 'manifest':
        emit(manifest(args.assets))
        return
    if not args.target:
        fail('--target is required for AWS operations.')
    target, clients, identity = aws_clients(args)
    report = verify(target, clients, identity)
    if args.action == 'verify':
        emit(report)
    elif args.action == 'publish':
        emit(publish(args, target, clients))
    else:
        if not args.record:
            fail('--record is required for rollback.')
        emit(rollback(args, target, clients))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # AWS exceptions never include credentials. Do not dump sessions/config.
        print(f'Coming-soon operation stopped: {exc}', file=sys.stderr)
        sys.exit(1)
