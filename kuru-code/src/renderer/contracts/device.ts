import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { SettingsSecretValue } from "./settingsSecretValue";

export const DeviceHostId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type DeviceHostId = typeof DeviceHostId.Type;

const ConfiguredDeviceHostId = DeviceHostId.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  Schema.makeFilter((id) => id !== "local" || "The local host id is reserved."),
);

export const SshDeviceHostConfig = Schema.Struct({
  // Hosts saved before EAS hosts existed carry no kind.
  kind: Schema.Literal("ssh").pipe(Schema.withDecodingDefaultKey(Effect.succeed("ssh" as const))),
  id: ConfiguredDeviceHostId,
  label: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString.check(Schema.isPattern(/^[^\s-][^\s]*$/)),
  identityFile: Schema.optional(TrimmedNonEmptyString),
  port: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
});
export type SshDeviceHostConfig = typeof SshDeviceHostConfig.Type;

/**
 * Cloud simulators from EAS Simulator. Sessions bill the Expo account until
 * they stop, so every one is bounded. The Expo credential is not stored here.
 */
export const EasDeviceHostConfig = Schema.Struct({
  kind: Schema.Literal("eas"),
  id: ConfiguredDeviceHostId,
  label: TrimmedNonEmptyString,
  /** EAS project that sessions run under, when the project's app config does not name one. */
  appId: Schema.optional(TrimmedNonEmptyString),
  /**
   * Expo access token, kept in the secret store, or the secret provider to read
   * it from. When empty the server uses EXPO_TOKEN, then the `eas login` session.
   * This is `secretSetting` from settings.ts, which imports this module.
   */
  accessToken: SettingsSecretValue.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("")),
    Schema.annotateKey({ settingsSecret: true }),
  ),
  /** EAS allows at most 40 minutes on free accounts and 115 on paid ones. */
  maxSessionMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 115 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(30)),
  ),
  idleMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(10)),
  ),
  maxConcurrentSessions: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(2)),
  ),
}).check(
  // EAS requires the idle limit to be smaller than the session limit.
  Schema.makeFilter(
    (host: { readonly idleMinutes: number; readonly maxSessionMinutes: number }) =>
      host.idleMinutes < host.maxSessionMinutes ||
      "Idle minutes must be smaller than session minutes.",
  ),
);
export type EasDeviceHostConfig = typeof EasDeviceHostConfig.Type;

/**
 * Alpha: devices leased from a Simlock gateway (https://incubator.callstack.com/simlock).
 * T3 never installs Simlock; the gateway and its workers are the user's own.
 */
export const SimlockDeviceHostConfig = Schema.Struct({
  kind: Schema.Literal("simlock"),
  id: ConfiguredDeviceHostId,
  label: TrimmedNonEmptyString,
  /** The gateway's origin, such as https://gateway.example.ts.net:4700. */
  gatewayUrl: TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\/[^\s/]+\/?$/)),
  /**
   * Leases, drives, watches, and takes input on its own leases. Kept in the secret store, or the
   * secret provider to read it from.
   */
  agentToken: SettingsSecretValue.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("")),
    Schema.annotateKey({ settingsSecret: true }),
  ),
  maxLeases: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(2)),
  ),
  /** A lease the Device panel keeps alive ends this long after it started. */
  maxLeaseMinutes: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 240 })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(60)),
  ),
});
export type SimlockDeviceHostConfig = typeof SimlockDeviceHostConfig.Type;

const uniqueHostIds = Schema.makeFilter(
  (hosts: ReadonlyArray<{ readonly id: string }>) =>
    new Set(hosts.map((host) => host.id)).size === hosts.length ||
    "Device host ids must be unique.",
);

export const SshDeviceHostConfigs = Schema.Array(SshDeviceHostConfig).check(uniqueHostIds);

/**
 * Kept apart from the SSH hosts in settings: servers and clients from before
 * EAS hosts decode `deviceHosts` as SSH hosts and would reject the whole file
 * or snapshot over one EAS entry.
 */
export const EasDeviceHostConfigs = Schema.Array(EasDeviceHostConfig).check(uniqueHostIds);

/** Kept apart from the other host lists for the same reason as EAS hosts. */
export const SimlockDeviceHostConfigs = Schema.Array(SimlockDeviceHostConfig).check(uniqueHostIds);

