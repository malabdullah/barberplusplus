#!/usr/bin/env python3
"""Conservative pg_dump formatting normalization; never rewrite SQL literals."""
import re,sys

class Lexer:
 def __init__(self):self.mode='normal';self.tag=None;self.depth=0;self.escape_string=False
 def feed(self,line):
  i=0
  while i<len(line):
   c=line[i];n=line[i:i+2]
   if self.mode=='single':
    if c=='\\' and self.escape_string:i+=2;continue
    if n=="''":i+=2;continue
    if c=="'":self.mode='normal'
   elif self.mode=='double':
    if n=='""':i+=2;continue
    if c=='"':self.mode='normal'
   elif self.mode=='dollar':
    if line.startswith(self.tag,i):i+=len(self.tag);self.mode='normal';self.tag=None;continue
   elif self.mode=='block':
    if n=='/*':self.depth+=1;i+=2;continue
    if n=='*/':
     self.depth-=1;i+=2
     if self.depth==0:self.mode='normal'
     continue
   else:
    if n=='--':return
    if n=='/*':self.mode='block';self.depth=1;i+=2;continue
    if c=="'":
     self.mode='single';self.escape_string=bool(re.search(r'(?:^|[^A-Za-z0-9_$])E$',line[:i],re.I))
    elif c=='"':self.mode='double'
    elif c=='$' and (i==0 or not re.match(r'[A-Za-z0-9_$]',line[i-1])):
     m=re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$',line[i:])
     if m:self.tag=m.group();self.mode='dollar';i+=len(self.tag);continue
   i+=1

def normalize(text):
 lex=Lexer();lines=[]
 for line in text.split('\n'):
  normal=lex.mode=='normal'
  if normal and re.match(r'^-- (Dumped |Started on |Completed on )',line):continue
  if normal and not line.strip():continue
  lex.feed(line);lines.append((line,normal and lex.mode=='normal'))
 if lex.mode!='normal':raise ValueError('Unterminated SQL literal/comment: refuse normalization')
 # Only the exact reviewed commutative schema USAGE ACL block is sorted.
 # Role grants, grant options, REVOKE, other objects and statements are barriers.
 grant=re.compile(r'GRANT USAGE ON SCHEMA "public" TO "(?:postgres|anon|authenticated|service_role|barber_reminder_writer)";')
 out=[];pending=[]
 for line,normal in lines:
  if normal and grant.fullmatch(line):pending.append(line);continue
  out.extend(sorted(pending));pending=[];out.append(line)
 out.extend(sorted(pending));return '\n'.join(out)+'\n'

def behavioral_schema(text):
 """Ignore only parsed top-level COMMENT statements and one reviewed role set.

 Return a separate fingerprint; never substitute this for the full audit dump.
 Function bodies and quoted strings are not rewritten.
 """
 lex=Lexer();buf=[];out=[]
 for line in normalize(text).splitlines():
  buf.append(line);lex.feed(line)
  if lex.mode=='normal' and line.rstrip().endswith(';'):
   statement='\n'.join(buf);buf=[]
   if statement.startswith('COMMENT ON '):continue
   if statement=='CREATE POLICY "Service role full access to rate_limits" ON "public"."rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);':
    statement='CREATE POLICY "Service role full access to rate_limits" ON "public"."rate_limits" TO "anon", "authenticated" USING (false) WITH CHECK (false);'
   out.append(statement)
 if buf:out.extend(buf)
 return '\n'.join(out)+'\n'
if __name__=='__main__':
 with open(sys.argv[1],newline='')as f:sys.stdout.write(normalize(f.read()))
