import * as Schema from "effect/Schema";

import { TrimmedString } from "./baseSchemas";
import { SecretReference } from "./secretReference";

/**
 * A credential setting: the literal, which is kept in the secret store and redacted for
 * clients, or the secret reference to read it from, which is not itself a secret and is
 * stored and shown as written. Typing a settings field with it is the whole declaration:
 * forms offer a secret provider for it and the server reads the secret for its consumer.
 */
export const SettingsSecretValue = Schema.Union([TrimmedString, SecretReference]).pipe(
  Schema.annotateKey({ settingsSecret: true, settingsSecretReference: true }),
);
export type SettingsSecretValue = typeof SettingsSecretValue.Type;

