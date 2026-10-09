#!/usr/bin/env python3
"""Read-only deployment check: fetch static files without executing JavaScript.

Does not call Google Analytics, submit events, change AWS or bypass TLS checks.
Run only after console upload and CloudFront invalidation have completed.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import ssl
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
ALLOWED_HOSTS = {'vanly.me', 'www.vanly.me', 'd3efg33xz921lx.cloudfront.net'}
FILES = {'index.html': 'text/html', 'styles.css': 'text/css', 'analytics.js': 'text/javascript'}


class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.measurement_ids = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag.lower() == 'meta' and attributes.get('name') == 'ga4-measurement-id':
            self.measurement_ids.append(attributes.get('content', '').strip())


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        return None


def evaluate_payload(key, payload, content_type, status_code, expected_hash, measurement_id):
    result = {'key': key, 'statusCode': status_code, 'bytes': len(payload),
              'sha256': hashlib.sha256(payload).hexdigest(), 'expectedSha256': expected_hash,
              'contentType': content_type}
    result['hashMatches'] = result['sha256'] == expected_hash
    result['mimeMatches'] = content_type.split(';', 1)[0].strip().lower() == FILES[key]
    if key == 'index.html':
        parser = MetaParser()
        parser.feed(payload.decode('utf-8'))
        result['observedMeasurementIds'] = parser.measurement_ids
        result['measurementIdMatches'] = parser.measurement_ids == [measurement_id]
    result['passed'] = (status_code == 200 and result['hashMatches'] and result['mimeMatches']
                        and result.get('measurementIdMatches', True))
    return result


def fetch(item):
    host, key, expected_hash, measurement_id = item
    url = f'https://{host}/' if key == 'index.html' else f'https://{host}/{key}'
    try:
        opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
        request = Request(url, headers={'User-Agent': 'Vanly-static-deployment-check/1.0', 'Accept-Encoding': 'identity'})
        with opener.open(request, timeout=15) as response:
            result = evaluate_payload(key, response.read(), response.headers.get('Content-Type', ''),
                                      response.status, expected_hash, measurement_id)
        return {'url': url, **result}
    except HTTPError as exc:
        return {'url': url, 'key': key, 'statusCode': exc.code, 'error': str(exc), 'passed': False}
    except Exception as exc:
        return {'url': url, 'key': key, 'error': str(exc), 'passed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', action='append', help='Known Vanly host; repeat to check multiple hosts.')
    parser.add_argument('--assets', type=Path, default=ROOT / 'apps' / 'coming-soon')
    parser.add_argument('--measurement-id', default='G-6P7XHCK7L7')
    parser.add_argument('--report', type=Path, default=ROOT / '.local' / 'coming-soon' / 'analytics-public-verification.json')
    args = parser.parse_args()
    hosts = args.host or ['vanly.me', 'www.vanly.me', 'd3efg33xz921lx.cloudfront.net']
    if any(host not in ALLOWED_HOSTS for host in hosts):
        parser.error('Only the three known Vanly hostnames are allowed.')
    if not re.fullmatch(r'G-[A-Z0-9]{10}', args.measurement_id):
        parser.error('A real GA4 measurement ID is required.')
    hashes = {key: hashlib.sha256((args.assets / key).read_bytes()).hexdigest() for key in FILES}
    tasks = [(host, key, hashes[key], args.measurement_id) for host in hosts for key in FILES]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(fetch, tasks))
    report = {'verifiedAtUtc': datetime.now(timezone.utc).isoformat(), 'readOnly': True,
              'javascriptExecuted': False, 'analyticsEventsSent': False,
              'resolutionMethod': 'default OS networking; no DNS/IP override; normal TLS validation; no redirects followed',
              'expectedMeasurementId': args.measurement_id, 'expectedLocalHashes': hashes,
              'results': results, 'allFileChecksPassed': all(result['passed'] for result in results),
              'scope': 'Static deployment bytes, MIME and HTML G-ID only; does not verify consent behavior or actual GA4 data collection.'}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    args.report.chmod(0o600)
    print(json.dumps({'report': str(args.report), 'passed': sum(result['passed'] for result in results),
                      'checks': len(results), 'allFileChecksPassed': report['allFileChecksPassed']}, indent=2))
    return 0 if report['allFileChecksPassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
