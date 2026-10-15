# Embedded browser environments

Set `FORM0_AI_DISABLED=1` in an embedded browser environment to keep AI authoring
and provider authentication out of its normal CLI workflow. Both `ai` at the
interactive prompt and `form0 ai` show instructions to continue locally and
return to the normal CLI prompt. The check happens before creating an AI
workspace or initializing provider authentication and session storage.

The variable is opt-in; ordinary local CLI behavior is unchanged. It is a
usability guard in an editable environment, not an isolation boundary. It does
not remove existing credentials or revoke provider authorizations.

For AI, download and extract the workspace, install its dependencies locally,
and run `form0` from the project directory without this variable. Authenticate
on your own computer. Do not include credentials in a shared workspace.
