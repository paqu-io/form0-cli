// Embedded browser environments, such as the form0 playground, set
// FORM0_CONNECTORS_DISABLED=1. The connectors need a native module or a database
// server those environments cannot provide, and configuring one would ask for
// database credentials there. The variable is opt-in; local behavior is unchanged.
export function connectorsDisabled() {
  return process.env.FORM0_CONNECTORS_DISABLED === '1';
}

export const CONNECTORS_DISABLED_MESSAGE =
  '[Connectors] Database connectors are not available in this environment.';

export const CONNECTORS_LOCAL_HINT =
  'Download your workspace and run form0 locally to store submissions with form0-connector-pg or form0-connector-sqlite: https://docs.form0.dev/connectors/overview';
