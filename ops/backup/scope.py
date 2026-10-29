"""Read-only B2 scope/privacy verification. Never uploads, deletes or lists files."""
import re,time,urllib.request,urllib.parse
BUCKET='barber-production-recovery-malabdullah-20261012'
BUCKET_ID='f196dd0d55982cf0a2190d18'
ENDPOINT='https://s3.us-east-005.backblazeb2.com'
PREFIX='production/v1/'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def validate_scope(auth,now=None):
 now=time.time() if now is None else now
 storage=auth['apiInfo']['storageApi'];allowed=storage['allowed']
 buckets=allowed.get('buckets')
 if not isinstance(buckets,list) or len(buckets)!=1 or buckets[0].get('id')!=BUCKET_ID or buckets[0].get('name') not in [None,BUCKET]:raise ValueError('Key must be restricted to exactly the production recovery bucket')
 if allowed.get('namePrefix')!=PREFIX:raise ValueError('Key must use exactly the production/v1/ filename prefix')
 capabilities=set(allowed.get('capabilities',[]))
 if not {'listBuckets','listFiles','readFiles','writeFiles','deleteFiles','listAllBucketNames'}<=capabilities:raise ValueError('Required scoped read/write or S3 bucket-name permissions missing')
 if capabilities & {'listKeys','writeKeys','deleteKeys'}:raise ValueError('Account-level key administration is not allowed')
 if auth['apiInfo'].get('groupsApi',{}).get('capabilities'):raise ValueError('Partner/group account access is not allowed')
 if storage.get('s3ApiUrl')!=ENDPOINT:raise ValueError('Backblaze returned a different S3 region')
 expiry=auth.get('applicationKeyExpirationTimestamp')
 if type(expiry) not in [int,float]:raise ValueError('Application key must expire within 90 days')
 expiry=expiry/1000 if expiry>100000000000 else expiry
 if not now<expiry<=now+90*86400+300:raise ValueError('Application key must expire within 90 days')
 parsed=urllib.parse.urlsplit(storage['apiUrl'])
 if parsed.scheme!='https' or not re.fullmatch(r'api[0-9]+\.backblazeb2\.com',parsed.hostname or '') or parsed.username or parsed.password or parsed.port not in [None,443] or parsed.path not in ['', '/'] or parsed.query or parsed.fragment:raise ValueError('Unexpected Backblaze API origin')
 return storage,capabilities,expiry

