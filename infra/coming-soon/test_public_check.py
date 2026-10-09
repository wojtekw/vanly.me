"""Offline checks only: no requests to the public site or Google Analytics."""
import hashlib
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('vanly_public_check', Path(__file__).with_name('check_public.py'))
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class PublicFileCheckTests(unittest.TestCase):
    def test_index_requires_one_matching_real_measurement_meta(self):
        html = b'<meta content="G-6P7XHCK7L7" name="ga4-measurement-id">'
        digest = hashlib.sha256(html).hexdigest()
        result = CHECK.evaluate_payload('index.html', html, 'text/html; charset=utf-8', 200, digest, 'G-6P7XHCK7L7')
        self.assertTrue(result['passed'])
        self.assertFalse(CHECK.evaluate_payload('index.html', html, 'text/html', 200, digest, 'G-AAAAAAAAAA')['passed'])
        duplicated = html + html
        self.assertFalse(CHECK.evaluate_payload('index.html', duplicated, 'text/html', 200,
                                              hashlib.sha256(duplicated).hexdigest(), 'G-6P7XHCK7L7')['passed'])

    def test_script_requires_correct_bytes_mime_and_status(self):
        body = b'/* script is fetched, never executed by this checker */'
        digest = hashlib.sha256(body).hexdigest()
        self.assertTrue(CHECK.evaluate_payload('analytics.js', body, 'text/javascript', 200, digest, 'G-6P7XHCK7L7')['passed'])
        self.assertFalse(CHECK.evaluate_payload('analytics.js', body, 'application/octet-stream', 200, digest, 'G-6P7XHCK7L7')['passed'])
        self.assertFalse(CHECK.evaluate_payload('analytics.js', body, 'text/javascript', 403, digest, 'G-6P7XHCK7L7')['passed'])
        self.assertFalse(CHECK.evaluate_payload('analytics.js', body + b'old', 'text/javascript', 200, digest, 'G-6P7XHCK7L7')['passed'])


if __name__ == '__main__':
    unittest.main()
