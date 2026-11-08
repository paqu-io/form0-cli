import assert from 'node:assert/strict';
import {
  expandBuildingPlanSchema,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from 'form0-core';
export function fixture(nodeOverrides = null) {
  const expanded = expandBuildingPlanSchema({
    form: {
      name: 'Shared wall editor',
      elements: [
        {
          type: 'BuildingPlanSection',
          key: 'plan',
          data_name: 'plan',
          label: 'Plan',
          description: null,
          description_mode: null,
          visible_conditions: null,
          read_only_conditions: null,
          visible: true,
          read_only: false,
          node_overrides: nodeOverrides,
        },
      ],
    },
  });
  const meta = expanded.buildingPlanMeta[0];
  const nodes = meta.repeatablesByNodeKey;
  const domain = createBuildingPlanSession({ properties: meta.properties });
  const floorId = domain.apply({
    type: 'create_floor',
    values: {
      floor_name: { choice: [{ value: 'ground_floor', label: 'Ground floor' }], other: [] },
      floor_elevation_m: 0,
      floor_height_m: 3,
      ...(nodeOverrides ? { default_wall_height: 3 } : {}),
    },
  }).created.id;
  for (const [x, y] of [
    [0, 0],
    [3, 3.2],
  ])
    domain.apply({
      type: 'create_room',
      floorId,
      rectangle: { x, y, width: 5, height: 3 },
      values: { room_name: { choice: [{ value: 'bedroom', label: 'Bedroom' }], other: [] } },
    });
  const floor = domain.getSnapshot().floors[0];
  const faceId = floor.rooms[0].faces[2].id;
  assert.equal(
    domain.apply({
      type: 'bind_faces',
      floorId,
      referenceFaceId: faceId,
      faceId: floor.rooms[1].faces[0].id,
    }).status,
    'applied'
  );
  const record = writeBuildingPlanRecord({ meta, plan: domain.getSnapshot() });
  record.repeatable[nodes.floors.preferredKey][0].id = 0;
  return { ...expanded, meta, nodes, record, floorId, faceId };
}
export const at = (row, path) =>
  path.reduce(
    (cursor, part) =>
      cursor.repeatable[part.repeatableKey].find(
        (entry) => (entry.id ?? entry.record_id) === part.instanceId
      ),
    row
  );
export const part = (key, row, index = 0) => ({
  repeatableKey: key,
  instanceId: row.id,
  index,
  identity: 'id',
});
