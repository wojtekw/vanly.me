"""Offline tests of publication scope, budget checks and version rollback."""
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from argparse import Namespace
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('vanly_coming_soon_deploy', Path(__file__).with_name('deploy.py'))
DEPLOY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEPLOY)


class FakeS3:
    def __init__(self):
        self.current = {'index.html': {'VersionId': 'old-index', 'ETag': 'old-index-etag', 'Metadata': {}}}
        self.puts, self.copies, self.deletes = [], [], []
        self.put_requests = []

    def head_object(self, Bucket, Key):
        if Key not in self.current:
            # Keep tests independent of SDK imports; tests override the wrapper.
            raise AssertionError('Use the patched head wrapper for absent objects.')
        return self.current[Key]

    def put_object(self, **kwargs):
        self.puts.append(kwargs['Key'])
        self.put_requests.append(kwargs)
        result = {'VersionId': f'v-{len(self.puts)}'}
        self.current[kwargs['Key']] = {**result, 'ETag': kwargs['Metadata']['sha256'], 'Metadata': kwargs['Metadata']}
        return result

    def copy_object(self, **kwargs):
        self.copies.append(kwargs)
        self.current[kwargs['Key']] = {'VersionId': 'restored', 'ETag': 'old-index-etag'}

    def delete_object(self, **kwargs):
        self.deletes.append(kwargs['Key'])
        self.current.pop(kwargs['Key'], None)

    def get_public_access_block(self, **kwargs):
        return {'PublicAccessBlockConfiguration': dict.fromkeys(['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets'], True)}

    def get_bucket_policy_status(self, **kwargs):
        return {'PolicyStatus': {'IsPublic': False}}

    def get_bucket_versioning(self, **kwargs):
        return {'Status': 'Enabled'}


class FakeCloudFront:
    def __init__(self):
        self.invalidations = []

    def get_distribution(self, **kwargs):
        return {'Distribution': {'ARN': 'arn:aws:cloudfront::434793037720:distribution/VANLY',
                'DomainName': 'vanly-test.cloudfront.net', 'Status': 'Deployed', 'DistributionConfig': {
                'Enabled': True, 'Aliases': {'Items': ['vanly.me', 'www.vanly.me']},
                'Origins': {'Items': [{'DomainName': 'vanly-test.s3.eu-central-1.amazonaws.com', 'OriginAccessControlId': 'oac'}]},
                'WebACLId': 'arn:waf', 'ViewerCertificate': {'ACMCertificateArn': 'arn:aws:acm:us-east-1:434793037720:certificate/test'}}}}

    def create_invalidation(self, **kwargs):
        self.invalidations.append(kwargs)
        return {'Invalidation': {'Id': f'i-{len(self.invalidations)}'}}


class FakePlan:
    def __init__(self, status='ACTIVE', tier='FREE'):
        self.status, self.tier = status, tier

    def get_subscription(self, **kwargs):
        return {'subscription': {'status': self.status, 'planTier': self.tier, 'resourceArns': [
                'arn:aws:cloudfront::434793037720:distribution/VANLY', 'arn:waf', 'arn:aws:route53:::hostedzone/ZVANLY']}}


class FakeRoute53:
    def get_hosted_zone(self, **kwargs):
        return {'HostedZone': {'Name': 'vanly.me.', 'Config': {'PrivateZone': False}}, 'DelegationSet': {'NameServers': ['ns1.example']}}


class FakeAcm:
    def describe_certificate(self, **kwargs):
        return {'Certificate': {'Status': 'ISSUED', 'SubjectAlternativeNames': ['vanly.me', 'www.vanly.me']}}


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'assets'
        self.source.mkdir()
        (self.source / 'index.html').write_text('<h1>Start 15 października</h1>')
        (self.source / 'styles.css').write_text('body{color:#345}')
        self.old_audit, DEPLOY.AUDIT = DEPLOY.AUDIT, Path(self.temp.name) / 'audit'
        self.addCleanup(setattr, DEPLOY, 'AUDIT', self.old_audit)
        self.clients = {'s3': FakeS3(), 'cf': FakeCloudFront(), 'ppm': FakePlan(), 'r53': FakeRoute53(), 'acm': FakeAcm()}
        self.target = {'accountId': '434793037720', 'bucket': 'vanly-test', 'distributionId': 'VANLY', 'subscriptionArn': 'arn:subscription', 'hostedZoneId': 'ZVANLY'}
        self.identity = {'Account': '434793037720', 'Arn': 'arn:principal'}

    def test_manifest_is_deterministic_and_does_not_publish_secrets(self):
        first = DEPLOY.manifest(self.source)
        self.assertEqual(first['sha256'], DEPLOY.manifest(self.source)['sha256'])
        (self.source / '.env').write_text('FAKE_KEY=do-not-publish')
        with self.assertRaisesRegex(RuntimeError, 'Hidden'):
            DEPLOY.manifest(self.source)

    def test_manifest_refuses_missing_index_and_symlinks(self):
        (self.source / 'index.html').unlink()
        with self.assertRaisesRegex(RuntimeError, 'index.html'):
            DEPLOY.manifest(self.source)
        (self.source / 'index.html').write_text('test')
        (self.source / 'linked.css').symlink_to(self.source / 'styles.css')
        with self.assertRaisesRegex(RuntimeError, 'symlinks'):
            DEPLOY.manifest(self.source)

    def test_manifest_accepts_actual_static_site_font_and_excludes_readme(self):
        actual = DEPLOY.manifest(DEPLOY.ROOT / 'apps' / 'coming-soon')
        keys = {entry['key'] for entry in actual['files']}
        self.assertIn('index.html', keys)
        self.assertIn('assets/Kalam-Bold.ttf', keys)
        self.assertIn('assets/OFL-Kalam.txt', keys)
        self.assertNotIn('README.md', keys)
        self.assertLess(actual['totalBytes'], 20 * 1024 * 1024)

    def test_javascript_asset_has_explicit_browser_compatible_mime(self):
        (self.source / 'analytics.js').write_text('/* analytics disabled until configured */')
        self.assertIn('analytics.js', {e['key'] for e in DEPLOY.manifest(self.source)['files']})
        old_head = DEPLOY.head
        DEPLOY.head = lambda s3, bucket, key: s3.current.get(key)
        self.addCleanup(setattr, DEPLOY, 'head', old_head)
        # Even a host with an unknown JS MIME must publish the script as text/javascript.
        with patch.object(DEPLOY.mimetypes, 'guess_type', return_value=('application/octet-stream', None)):
            DEPLOY.publish(Namespace(assets=str(self.source)), self.target, self.clients)
        uploaded = next(r for r in self.clients['s3'].put_requests if r['Key'] == 'analytics.js')
        self.assertEqual(uploaded['ContentType'], 'text/javascript; charset=utf-8')

    def test_verify_requires_active_free_plan(self):
        self.assertEqual(DEPLOY.verify(self.target, self.clients, self.identity)['planTier'], 'FREE')
        for status, tier in [('PENDING_APPROVAL', 'FREE'), ('ACTIVE', 'PRO')]:
            self.clients['ppm'] = FakePlan(status, tier)
            with self.assertRaisesRegex(RuntimeError, 'ACTIVE.*FREE'):
                DEPLOY.verify(self.target, self.clients, self.identity)

    def test_verify_requires_zone_covered_by_plan(self):
        self.target['hostedZoneId'] = 'ZANOTHER'
        with self.assertRaisesRegex(RuntimeError, 'zone is not attached'):
            DEPLOY.verify(self.target, self.clients, self.identity)

    def test_publish_idempotent_and_rollback_keeps_old_versions(self):
        old_head = DEPLOY.head
        DEPLOY.head = lambda s3, bucket, key: s3.current.get(key)
        self.addCleanup(setattr, DEPLOY, 'head', old_head)
        args = Namespace(assets=str(self.source))
        published = DEPLOY.publish(args, self.target, self.clients)
        self.assertEqual(self.clients['s3'].puts, ['styles.css', 'index.html'])
        self.assertEqual(published['uploadedFiles'], 2)
        self.assertEqual(DEPLOY.publish(args, self.target, self.clients)['uploadedFiles'], 0)
        self.assertEqual(len(self.clients['cf'].invalidations), 1)
        rolled_back = DEPLOY.rollback(Namespace(record=published['rollbackRecord']), self.target, self.clients)
        self.assertEqual(set(rolled_back['restored']), {'styles.css', 'index.html'})
        self.assertEqual(self.clients['s3'].copies[0]['CopySource']['VersionId'], 'old-index')
        self.assertEqual(self.clients['s3'].deletes, ['styles.css'])
        self.assertEqual(DEPLOY.rollback(Namespace(record=published['rollbackRecord']), self.target, self.clients)['restored'], [])


if __name__ == '__main__':
    unittest.main()
