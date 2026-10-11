import type { ActionEnvelope } from '../actions/envelope.js';
import { PIN_TEXT_MAX_LENGTH, PinComponent } from '../schema/entity.js';
import type { MigrationStep } from './runner.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keep the original whenever the stricter component cannot represent it losslessly. */
function normalizePin(entity: unknown): unknown {
  if (!record(entity) || !('pin' in entity) || PinComponent.safeParse(entity['pin']).success)
    return entity;
  const original = entity['pin'];
  const pin = record(original)
    ? {
        text:
          typeof original['text'] === 'string'
            ? original['text'].slice(0, PIN_TEXT_MAX_LENGTH)
            : '',
        reveal: original['reveal'],
      }
    : undefined;
  const parsed = PinComponent.safeParse(pin);
  return { ...entity, pin: parsed.success ? parsed.data : undefined, legacyPin: original };
}

function mapRecords(value: unknown, transform: (item: unknown) => unknown): unknown {
  return record(value)
    ? Object.fromEntries(Object.entries(value).map(([id, item]) => [id, transform(item)]))
    : value;
}

function scene(value: unknown): unknown {
  return record(value)
    ? { ...value, entities: mapRecords(value['entities'], normalizePin) }
    : value;
}

function campaign(value: unknown): unknown {
  if (!record(value)) return value;
  return {
    ...value,
    schemaVersion: 4,
    ...('scenes' in value ? { scenes: mapRecords(value['scenes'], scene) } : {}),
    ...('prefabs' in value
      ? {
          prefabs: mapRecords(value['prefabs'], (prefab) =>
            record(prefab) ? { ...prefab, entity: normalizePin(prefab['entity']) } : prefab,
          ),
        }
      : {}),
  };
}

export const v3ToV4: MigrationStep = {
  from: 3,
  migrate(payload, kind) {
    if (kind === 'scene') return scene(payload);
    if (kind === 'campaign') return campaign(payload);
    if (kind === 'snapshot' && record(payload))
      return { ...payload, state: campaign(payload['state']) };
    return payload;
  },
};

/** Logs are unversioned. Adapt archived pin writes before replaying the normal reducer. */
export function migrateLegacyPinEnvelope(envelope: ActionEnvelope): ActionEnvelope {
  const payload = envelope.payload;
  if (!record(payload)) return envelope;
  if (envelope.type === 'entity.create')
    return { ...envelope, payload: { ...payload, entity: normalizePin(payload['entity']) } };
  if (
    envelope.type === 'entity.update' &&
    record(payload['changes']) &&
    'pin' in payload['changes']
  )
    return { ...envelope, payload: { ...payload, changes: normalizePin(payload['changes']) } };
  return envelope;
}
