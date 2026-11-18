"""Local Chrome smoke/visual review. Requires running NOVA servers; no app launches.

Uses Chrome DevTools Protocol over pipes, with no extra Python packages.
Run: .venv/bin/python scripts/review_browser.py
Screenshots and machine-readable results go to docs/screenshots/v3/.
Physical audio, speech recognition, and OS launches are deliberately manual checks.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:5173')
    parser.add_argument('--chrome', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/screenshots/v3')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nova-review-') as profile, tempfile.TemporaryFile() as log:
        env = {**os.environ, 'NOVA_REVIEW_CHROME': args.chrome, 'NOVA_REVIEW_PROFILE': profile}
        process = subprocess.Popen(
            ['/bin/sh', '-c', 'exec "$NOVA_REVIEW_CHROME" --headless --disable-gpu --no-first-run --user-data-dir="$NOVA_REVIEW_PROFILE" --remote-debugging-pipe 3<&0 4>&1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, env=env,
        )
        buffer = b''
        sequence = 0
        errors = []
        results = {'url': args.url, 'checks': {}, 'screenshots': []}
        session = None

        def call(method, params=None, target=True):
            nonlocal buffer, sequence
            sequence += 1
            identifier = sequence
            message = {'id': identifier, 'method': method, 'params': params or {}}
            if target and session:
                message['sessionId'] = session
            process.stdin.write(json.dumps(message).encode() + b'\0')
            process.stdin.flush()
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                while b'\0' in buffer:
                    raw, buffer = buffer.split(b'\0', 1)
                    if not raw:
                        continue
                    value = json.loads(raw)
                    if value.get('method') == 'Runtime.exceptionThrown':
                        errors.append(value)
                    if value.get('method') == 'Log.entryAdded' and value['params']['entry'].get('level') == 'error':
                        errors.append(value)
                    if value.get('id') == identifier:
                        if 'error' in value:
                            raise RuntimeError(value['error'])
                        return value.get('result', {})
                if select.select([process.stdout], [], [], .5)[0]:
                    chunk = process.stdout.read1(65536)
                    if not chunk:
                        raise RuntimeError('Chrome pipe closed')
                    buffer += chunk
            raise TimeoutError(method)

        def evaluate(expression):
            result = call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True, 'userGesture': True})
            if 'exceptionDetails' in result:
                raise RuntimeError(result['exceptionDetails'])
            return result.get('result', {}).get('value')

        def settle(ms=300):
            evaluate(f'new Promise(resolve=>setTimeout(resolve,{ms}))')

        def click(selector):
            evaluate(f'document.querySelector({json.dumps(selector)}).click()')
            settle()

        def input_value(selector, value):
            evaluate("""(()=>{const el=document.querySelector(%s);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,%s);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()""" % (json.dumps(selector), json.dumps(value)))
            settle(100)

        def check(name, value, valid=True):
            results['checks'][name] = value
            print(name, json.dumps(value), flush=True)
            if not valid:
                raise AssertionError(name)

        def screenshot(name):
            data = call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': True})
            filename = name + '.png'
            (args.output / filename).write_bytes(base64.b64decode(data['data']))
            results['screenshots'].append(filename)

        def key(name, shift=False):
            call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': name, 'code': name, 'modifiers': 8 if shift else 0})
            call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': name, 'code': name})
            settle(100)

        try:
            target = call('Target.createTarget', {'url': 'about:blank'}, target=False)['targetId']
            session = call('Target.attachToTarget', {'targetId': target, 'flatten': True}, target=False)['sessionId']
            for domain in ['Page', 'Runtime', 'Log']:
                call(domain + '.enable')
            call('Page.navigate', {'url': args.url})
            settle(1500)
            evaluate('document.fonts.ready')
            check('backend_connected', evaluate('document.querySelector(".connection").textContent'), evaluate('!!document.querySelector(".connection.connected")'))
            for width, height in [(1920, 1200), (1440, 1100), (850, 1100), (390, 1000), (320, 900)]:
                call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': False})
                evaluate('window.scrollTo(0,0)')
                settle(350)
                layout = evaluate('({viewport:innerWidth,width:document.documentElement.scrollWidth,top:scrollY,nav:!!document.querySelector(".sidebar").getClientRects().length})')
                check('layout_' + str(width), layout, layout['viewport'] == layout['width'] and layout['top'] == 0 and layout['nav'])
                screenshot('dashboard-' + str(width))
            call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 1100, 'deviceScaleFactor': 1, 'mobile': False})
            click('.palette-trigger')
            check('palette_focus', evaluate('document.activeElement.getAttribute("aria-label")'), evaluate('document.activeElement.getAttribute("aria-label")==="Search commands"'))
            key('Tab', True)
            check('palette_focus_trap', evaluate('!!document.activeElement.closest("[role=dialog]")'), evaluate('!!document.activeElement.closest("[role=dialog]")'))
            screenshot('palette')
            key('Escape')
            input_value('[aria-label="Command"]', 'what time is it?')
            evaluate('document.querySelector("form").requestSubmit()')
            settle(1200)
            text = evaluate('document.querySelector(".messages").innerText')
            check('real_time_command', text, 'The time is' in text)
            evaluate("document.querySelector('[aria-label=\"Stop speaking\"]')?.click()")
            settle(200)
            click('.trace-stage:nth-child(5)')
            check('trace_response_details', evaluate('document.querySelector(".stage-detail").innerText'))
            evaluate('window.scrollTo(0,0)')
            screenshot('execution')
            evaluate("Array.from(document.querySelectorAll('.quick-card')).find(el=>el.innerText.includes('Open Calculator')).click()")
            settle(500)
            check('confirmation_required', evaluate('!!document.querySelector(".confirm-card")'), evaluate('!!document.querySelector(".confirm-card")'))
            evaluate("Array.from(document.querySelectorAll('.confirm-card button')).find(el=>el.textContent==='Cancel').click()")
            settle()
            check('confirmation_canceled', evaluate('document.querySelector(".trace-stage:nth-child(4)").innerText'))
            click('[aria-label="Voice Studio"]')
            studio = evaluate('({dialog:!!document.querySelector(".settings-panel"),permission:document.querySelector(".permission-status").innerText,voices:document.querySelectorAll(".voice-options button").length})')
            check('voice_studio', studio, studio['dialog'])
            screenshot('studio-input')
            evaluate('document.querySelector(".studio-body").scrollTop=570')
            settle()
            screenshot('studio-output')
            input_value('[aria-label="Search voices"]', 'no such voice 123')
            check('voice_search', evaluate('document.querySelector(".voice-options").innerText'), evaluate('document.querySelector(".voice-options").innerText.includes("No voices match")'))
            click('[aria-label="Close settings"]')
            input_value('[aria-label="Activity category"]', 'command')
            input_value('[aria-label="Search activity"]', 'canceled')
            check('console_filter', evaluate('document.querySelector(".console-lines").innerText'), evaluate('document.querySelector(".console-lines").innerText.toLowerCase().includes("canceled")'))
            input_value('[aria-label="Search activity"]', '')
            input_value('[aria-label="Activity category"]', 'all')
            # Theme toggles persist normally. Restore the original even if a screenshot fails.
            original_theme = evaluate('document.documentElement.dataset.theme')
            try:
                click('[aria-label="Toggle theme"]')
                check('alternate_theme', evaluate('({theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth})'))
                screenshot('alternate-theme')
            finally:
                if evaluate('document.documentElement.dataset.theme') != original_theme:
                    click('[aria-label="Toggle theme"]')
            evaluate("Array.from(document.querySelectorAll('.first-contact button')).find(el=>el.textContent.includes('Meet NOVA')).click()")
            settle()
            screenshot('onboarding')
            for _ in range(4):
                evaluate("Array.from(document.querySelectorAll('.onboarding-actions button')).find(el=>el.textContent.includes('Continue')).click()")
                settle(180)
            check('onboarding_last_step', evaluate('document.querySelector(".onboarding-copy").innerText'))
            evaluate("Array.from(document.querySelectorAll('.onboarding-actions button')).find(el=>el.textContent.includes('Open command palette')).click()")
            settle(450)
            check('onboarding_saved', evaluate('localStorage.getItem("nova.onboarding.v3")'), evaluate('localStorage.getItem("nova.onboarding.v3")==="done"'))
            key('Escape')
            # Warm caches, then compare listeners/nodes after repeated modal lifecycles.
            for _ in range(2):
                click('.palette-trigger')
                key('Escape')
                settle()
            call('HeapProfiler.collectGarbage')
            baseline = call('Memory.getDOMCounters', target=False)
            for _ in range(8):
                click('.palette-trigger')
                key('Escape')
                settle()
            call('HeapProfiler.collectGarbage')
            after = call('Memory.getDOMCounters', target=False)
            check('modal_lifecycle_counters', {'baseline': baseline, 'after': after}, after['jsEventListeners'] <= baseline['jsEventListeners'] + 2 and after['nodes'] <= baseline['nodes'] + 10)
            call('Emulation.setEmulatedMedia', {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
            check('reduced_motion', evaluate('getComputedStyle(document.querySelector(".outer-orbit")).animationName'), evaluate('getComputedStyle(document.querySelector(".outer-orbit")).animationName==="none"'))
            check('fonts', evaluate("({heading:document.fonts.check('400 20px \"Space Grotesk\"'),ui:document.fonts.check('400 12px Inter'),mono:document.fonts.check('400 12px \"JetBrains Mono\"')})"))
            tree = call('Accessibility.getFullAXTree')['nodes']
            check('accessibility_tree', {'nodes': len(tree), 'unlabeled_buttons': [n.get('nodeId') for n in tree if n.get('role', {}).get('value') == 'button' and not n.get('ignored') and not n.get('name', {}).get('value')]})
            check('console_errors', errors, not errors)
            results['passed'] = True
        except Exception as error:
            results['passed'] = False
            results['error'] = str(error)
            raise
        finally:
            (args.output / 'browser-results.json').write_text(json.dumps(results, indent=2) + '\n')
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)


if __name__ == '__main__':
    main()
