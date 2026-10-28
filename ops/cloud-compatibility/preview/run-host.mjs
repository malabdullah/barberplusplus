// Called only by the explicit owner-approved bootstrap after encrypted import/cache erasure.
if(process.argv[2]!=='--owner-approved'){console.log('PLAN ONLY: explicit owner-reviewed bootstrap required');process.exit(0);}
try{const {runReviewed}=await import('./reviewed-runner.mjs');await runReviewed({ownerApproved:true,privateTmpfsRoot:process.argv[3],publishableConfig:process.argv[4]});}
catch{process.exitCode=1;} // Never print raw SDK/credential errors.
