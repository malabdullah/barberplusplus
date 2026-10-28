using System.Reflection;using System.Runtime.Loader;using System.Text.Json;using System.Security.Cryptography;
class Program {
 static string Stage="INIT";
 static readonly string Base=Environment.GetEnvironmentVariable("BARBER_DEVTUNNEL_ASSEMBLIES")??throw new InvalidOperationException("PINNED_ASSEMBLIES_REQUIRED");
 static object Call(object target,string name,params object[] args)=>target.GetType().GetMethods(BindingFlags.Public|BindingFlags.Instance).Single(m=>m.Name==name&&m.GetParameters().Length==args.Length).Invoke(target,args)!;
 static async Task<int> Main(string[] args) {
  try {
   AssemblyLoadContext.Default.Resolving+=(ctx,n)=>File.Exists(Base+"/"+n.Name+".dll")?ctx.LoadFromAssemblyPath(Base+"/"+n.Name+".dll"):null;
   string dll=args.Length>2&&args[2]=="full"?(Environment.GetEnvironmentVariable("BARBER_MSAL_UNTRIMMED_DLL")??throw new InvalidOperationException("DUMMY_UNTRIMMED_ASSEMBLY_REQUIRED")):Base+"/Microsoft.Identity.Client.Extensions.Msal.dll";
   if(dll.StartsWith(Base)&&Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(dll))).ToLowerInvariant()!="f33790d699152d3a2de2c6c8cbc4c73a1c0f35c05cc484aa5b4894ccc0f5f301")return 23;var a=AssemblyLoadContext.Default.LoadFromAssemblyPath(dll);var builder=a.GetType("Microsoft.Identity.Client.Extensions.Msal.StorageCreationPropertiesBuilder")!;var helperType=a.GetType("Microsoft.Identity.Client.Extensions.Msal.MsalCacheHelper")!;
   if(args.Length==0){Console.WriteLine(JsonSerializer.Serialize(new{version=a.GetName().Version?.ToString(),informational=a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,sha256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(a.Location))).ToLowerInvariant(),methods=builder.GetMethods(BindingFlags.Public|BindingFlags.Instance).Select(m=>m.Name).Distinct().ToArray()}));return 0;}
   var mode=args[0];var root=Path.GetFullPath(args[1]);var state=Environment.GetEnvironmentVariable("DEVTUNNELS_USER_STATE_DIR");
   if(!root.StartsWith("/dev/shm/barber-owner-")||state!=root+"/state"||!Directory.Exists(state)||Environment.GetEnvironmentVariable("XDG_DATA_HOME")!=root+"/data"||string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DBUS_SESSION_BUS_ADDRESS")))return 20;
   if(mode=="cli-serialize-dummy"){
    Stage="CLI_DUMMY_SERIALIZER";var cli=AssemblyLoadContext.Default.LoadFromAssemblyPath(Base+"/devtunnel.dll");
    var recordType=cli.GetType("Microsoft.DevTunnels.Cli.Authentication.GitHubApp+CachedTokenInfo",true)!;
    var record=Activator.CreateInstance(recordType,true)!;
    foreach(var pair in new Dictionary<string,object>{{"AccessToken","SYNTHETIC_ONLY_"+new string('x',32)},{"AccessTokenExpirationDate",DateTime.UtcNow.AddHours(2)},{"RefreshToken","SYNTHETIC_REFRESH_ONLY"},{"RefreshTokenExpirationDate",DateTime.UtcNow.AddHours(4)},{"Scopes",new[]{"read:user","read:org"}},{"UserId",(ulong)123},{"Login","MaLaBdUlLaH"}})recordType.GetProperty(pair.Key)!.SetValue(record,pair.Value);
    var array=Array.CreateInstance(recordType,1);array.SetValue(record,0);
    var serializer=typeof(JsonSerializer).GetMethods().Single(m=>m.Name=="SerializeToUtf8Bytes"&&m.IsGenericMethodDefinition&&m.GetParameters().Length==2&&m.GetParameters()[1].ParameterType==typeof(JsonSerializerOptions)).MakeGenericMethod(array.GetType());
    var payload=(byte[])serializer.Invoke(null,new object?[]{array,null})!;
    var optionsType=cli.GetType("Microsoft.DevTunnels.Cli.Options.CommonOptions",true)!;var options=Activator.CreateInstance(optionsType)!;
    var basename=Path.GetFileName((string)Call(options,"GetTokenCacheFilePath","github"));
    var wrapper=JsonSerializer.SerializeToUtf8Bytes(new{basename,payload=JsonDocument.Parse(payload).RootElement,runtime=Environment.Version.ToString(),serializer=typeof(JsonSerializer).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion});using var stdout=Console.OpenStandardOutput();stdout.Write(wrapper);return 0;
   }
   var b=Activator.CreateInstance(builder,"devtunnels-tokens-github",state)!;
   if(mode!="ram-read"&&mode!="ram-dummy"&&mode!="ram-clear")Call(b,"WithMacKeyChain","tunnels","https://global.rel.tunnels.api.visualstudio.com/auth/github");
   if(mode=="ram-read"||mode=="ram-dummy"||mode=="ram-clear"){
    if((mode=="ram-read"||mode=="ram-clear")&&!File.Exists(state+"/devtunnels-tokens-github"))return 21;
    Call(b,"WithUnprotectedFile"); // Match an ALREADY selected approved RAM cache, never change CLI behavior.
   }
   if(mode=="secure-dummy"){
    // Synthetic standalone supported secure configuration, not the pinned CLI's defaults.
    Call(b,"WithLinuxKeyring","barber.msal.synthetic","default","SYNTHETIC ONLY",new KeyValuePair<string,string>("application","barber-msal-synthetic"),new KeyValuePair<string,string>("session",Path.GetFileName(root)));
   }
   Stage="BUILD";object props=Call(b,"Build");var create=helperType.GetMethods(BindingFlags.Public|BindingFlags.Static).Single(m=>m.Name=="CreateAsync"&&m.GetParameters().Length==2);
   Stage="CREATE";var task=(Task)create.Invoke(null,new object?[]{props,null})!;await task;var helper=task.GetType().GetProperty("Result")!.GetValue(task)!;
   if(mode.EndsWith("-dummy")){
    var payload=System.Text.Encoding.UTF8.GetBytes("SYNTHETIC_PINNED_MSAL_PAYLOAD");Stage="SAVE";Call(helper,"SaveUnencryptedTokenCache",payload);Stage="READ";var read=(byte[])Call(helper,"LoadUnencryptedTokenCache");bool same=CryptographicOperations.FixedTimeEquals(payload,read);Call(helper,"SaveUnencryptedTokenCache",Array.Empty<byte>());
    Console.WriteLine(JsonSerializer.Serialize(new{result=same?"PASS":"FAIL",mode,library=args.Length>2?args[2]:"pinned",publicDecryptedRead=true}));return same?0:22;
   }
   if(mode=="ram-clear"||mode=="secure-clear"){Stage="CLEAR";Call(helper,"SaveUnencryptedTokenCache",Array.Empty<byte>());return 0;}
   Stage="READ";var bytes=(byte[])Call(helper,"LoadUnencryptedTokenCache");using(var stdout=Console.OpenStandardOutput()){stdout.Write(bytes);}CryptographicOperations.ZeroMemory(bytes);return 0;
  }catch(Exception e){while(e is TargetInvocationException&&e.InnerException!=null)e=e.InnerException;Console.Error.WriteLine("MSAL_STAGE_"+Stage);if(new[]{"ArgumentException","TypeInitializationException","NotSupportedException","PlatformNotSupportedException","MissingManifestResourceException","MissingFieldException","MethodAccessException","FieldAccessException","FileLoadException","IOException","UnauthorizedAccessException","DllNotFoundException","EntryPointNotFoundException","InvalidCastException","AmbiguousMatchException","TargetParameterCountException"}.Contains(e.GetType().Name))Console.Error.WriteLine("MSAL_TYPE_"+e.GetType().Name);Console.Error.WriteLine(e.GetType().Name=="ArgumentNullException"?"MSAL_PROPERTIES_UNCONFIGURED":e.GetType().Name=="MsalCachePersistenceException"?"MSAL_SECURE_PERSISTENCE_UNAVAILABLE":e is FileNotFoundException?"MSAL_DEPENDENCY_MISSING":e is TypeLoadException?"MSAL_TYPE_LOAD":e is MissingMethodException?"MSAL_METHOD_UNAVAILABLE":e is InvalidOperationException?"MSAL_PUBLIC_METHOD_SELECTION":e is NullReferenceException?"MSAL_NULL_RESULT":"MSAL_API_FAILURE");return 30;}
 }
}
