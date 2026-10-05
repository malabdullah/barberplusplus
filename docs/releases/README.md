# Production Release Records

Copy `template.md` to `vX.Y.Z.md` before creating a release tag. The completed
record must be committed on the exact staging-accepted commit. Production CI
requires the two literal decisions below before it can reach the protected
GitHub `production` approval gate:

- `Release preparation decision: PASS`
- `Migration compatibility decision: PASS`

The preparation marker confirms that the candidate's release record, owners,
rollback procedure, and staging acceptance criteria were reviewed before merge.
The successful staging artifact created from that exact commit is the authority
for the final commit, digest, migration set, run ID, and acceptance time. This
avoids requiring a post-acceptance documentation commit that would change the
commit and image identity. The markers do not authorize deployment. The owner
must still explicitly approve the specific tag and staging digest, then approve
that same pending deployment in the protected GitHub environment.

Never put credentials, tokens, customer records, or unredacted logs here.
