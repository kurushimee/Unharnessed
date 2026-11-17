import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderDriverKind } from "./providerInstance";
import { RuntimeMode } from "./providerPolicy";

/**
 * How T3 Code updates itself. `auto` is the default: it checks, and installs only when a user
 * asks. `off` never checks, for machines that get T3 Code through MDM.
 */
export const ManagedUpdatesMode = Schema.Literals(["auto", "off"]);
export type ManagedUpdatesMode = typeof ManagedUpdatesMode.Type;

const HttpsUrl = TrimmedNonEmptyString.check(
  Schema.makeFilter((value: string) => /^https:\/\/[^\s/]+/i.test(value.trim()), {
    expected: "an https URL",
  }),
);

export const ManagedUpdatesPolicy = Schema.Struct({
  mode: ManagedUpdatesMode,
  /** A generic electron-updater feed the desktop app updates from instead of GitHub. */
  feedUrl: Schema.optionalKey(HttpsUrl),
  /** `false` makes the nightly channel unavailable. */
  allowNightly: Schema.optionalKey(Schema.Boolean),
});
export type ManagedUpdatesPolicy = typeof ManagedUpdatesPolicy.Type;

/** A kind of client the server may accept, mapped onto `ServerAuthPolicy`. */
export const ManagedPolicyClient = Schema.Literals(["desktop", "local-browser", "remote"]);
export type ManagedPolicyClient = typeof ManagedPolicyClient.Type;

/** The limits clients see: what the server enforces, which can be broader than the file says. */
export const ManagedPolicySummaryLimits = Schema.Struct({
  maxRuntimeMode: Schema.optionalKey(RuntimeMode),
  clients: Schema.optionalKey(Schema.NonEmptyArray(ManagedPolicyClient)),
  /** `false` also when `clients` leaves out `remote`, since Connect is remote access. */
  connect: Schema.optionalKey(Schema.Boolean),
  webhookTasks: Schema.optionalKey(Schema.Boolean),
  telemetry: Schema.optionalKey(Schema.Boolean),
  browserCookieImport: Schema.optionalKey(Schema.Boolean),
  providers: Schema.optionalKey(
    Schema.Struct({
      /** Absent means every driver is allowed. */
      allowedDrivers: Schema.optionalKey(Schema.NonEmptyArray(ProviderDriverKind)),
      /**
       * Per driver, the instance fields users cannot change, as dot paths into the instance
       * envelope: `config.binaryPath`, `config.launchArgs`, `environment.<NAME>`. A bare
       * `environment` means every variable, as under `maxRuntimeMode`, where each driver's
       * launch configuration belongs to the administrator.
       */
      lockedInstanceFields: Schema.optionalKey(
        Schema.Record(ProviderDriverKind, Schema.Array(Schema.String)),
      ),
    }),
  ),
  /** No `feedUrl`: it can carry a token, and only the desktop app, which reads the file, uses it. */
  updates: Schema.optionalKey(ManagedUpdatesPolicy.mapFields(Struct.omit(["feedUrl"]))),
});
export type ManagedPolicySummaryLimits = typeof ManagedPolicySummaryLimits.Type;

/** What clients learn about the policy: enough to explain a locked control, no values. */
export const ManagedPolicySummary = Schema.Struct({
  organization: TrimmedNonEmptyString,
  supportUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** Dot paths into `ServerSettings` that users cannot change. */
  lockedSettings: Schema.Array(Schema.String),
  /** What the server enforces; a missing key means no limit. */
  limits: Schema.optionalKey(ManagedPolicySummaryLimits),
});
export type ManagedPolicySummary = typeof ManagedPolicySummary.Type;

