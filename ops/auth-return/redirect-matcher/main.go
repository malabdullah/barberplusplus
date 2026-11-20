// Offline matcher probe: exact dependency and separators from Auth v2.189.0.
// No server, provider, browser, credentials or configuration writes.
package main
import("encoding/json";"fmt";"os";"strings";"github.com/gobwas/glob")
func main(){
 b,e:=os.ReadFile(os.Args[1]);if e!=nil{panic(e)}
 var m struct{SupabaseRedirects struct{Additions []string}};if e=json.Unmarshal(b,&m);e!=nil{panic(e)}
 id:="ad670000-0000-4000-8000-000000000099"
 hex:=strings.Repeat("[0123456789abcdef]",8)+"-"+strings.Repeat("[0123456789abcdef]",4)+"-"+strings.Repeat("[0123456789abcdef]",4)+"-"+strings.Repeat("[0123456789abcdef]",4)+"-"+strings.Repeat("[0123456789abcdef]",12)
 checks:=0
 for _,pattern:=range m.SupabaseRedirects.Additions{
  g:=glob.MustCompile(pattern,'.','/')
  valid:=strings.ReplaceAll(strings.ReplaceAll(pattern,hex,id),`\?`,`?`)
  if !g.Match(valid){panic("positive redirect rejected")};checks++
  invalid:=[]string{valid+"&redirect_to=https://foreign.invalid",valid+"#fragment",strings.ReplaceAll(valid,id,"bad"),strings.ReplaceAll(valid,id,strings.ToUpper(id)),strings.Replace(valid,"https://","http://",1),strings.Replace(valid,".alabdullah-cs.workers.dev",".foreign.invalid",1),strings.Replace(valid,"www.barberplusplus.com","foreign.invalid",1)}
  for _,bad:=range invalid{if bad==valid{continue};if g.Match(bad){panic("negative redirect accepted")};checks++}
 }
 fmt.Printf("{\"matcher\":\"github.com/gobwas/glob v0.2.3\",\"authSource\":\"v2.189.0\",\"patterns\":%d,\"checks\":%d,\"passed\":true,\"providerCalls\":0}\n",len(m.SupabaseRedirects.Additions),checks)
}
