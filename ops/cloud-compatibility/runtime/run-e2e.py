"""Use the selected source's own Playwright instance (avoids duplicate runners)."""
import os,subprocess,sys
from pathlib import Path
import profile
name=sys.argv[1]
if name not in profile.PROFILES:raise SystemExit('PROFILE_ALLOWLIST')
r,e,_=profile.context(name);repo=profile.source_repo(name);e['BARBER_CLOUD_PROFILE']=name
node=os.environ.get('BARBER_NODE',str(profile.BASE/'tooling/node/node_modules/.bin/node'))
raise SystemExit(subprocess.call([node,str(repo/'node_modules/@playwright/test/cli.js'),'test','--config',str(Path(__file__).with_name('playwright.qa.config.mjs')),*sys.argv[2:]],cwd=repo,env=e))
