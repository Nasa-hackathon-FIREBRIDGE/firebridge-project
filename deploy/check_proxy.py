"""Validate the production HTTPS config using isolated, throwaway TLS files."""
import argparse
from pathlib import Path
import subprocess
import tempfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--revision', required=True)
a=p.parse_args()
root=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='firebridge-tls-check-') as tmp:
    cert=Path(tmp)/'live/astramind.solutions'
    cert.mkdir(parents=True)
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
        '-subj','/CN=fixture.invalid','-keyout',str(cert/'privkey.pem'),
        '-out',str(cert/'fullchain.pem')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Only this throwaway fixture is world-readable; real keys remain root-only.
    Path(tmp).chmod(0o755)
    (cert/'privkey.pem').chmod(0o644)
    subprocess.run(['docker','run','--rm','--user','0:0','--entrypoint','nginx',
        '--read-only','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','SETUID',
        '--cap-add','SETGID','--cap-add','KILL','--security-opt','no-new-privileges:true',
        '--tmpfs','/tmp:size=32m','--add-host','api:127.0.0.1','--add-host','frontend:127.0.0.1',
        '-v',str(root/'nginx.proxy.conf')+':/etc/nginx/nginx.conf:ro',
        '-v',tmp+':/etc/letsencrypt:ro','firebridge-webapp-frontend:'+a.revision,'-t'],check=True)
