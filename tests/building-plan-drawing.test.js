import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvas } from '../src/server/static/building-plan-canvas.js';
import { BuildingPlanCanvasController, readBuildingPlanRecord } from 'form0-core';
import { fixture as planFixture } from './fixtures/building-plan-v2.js';

const wall = (id, roomId, y = 0) => ({
  id,
  roomId,
  points: [
    { x: 0, y },
    { x: 100, y },
  ],
});
function canvas() {
  return Object.assign(Object.create(BuildingPlanCanvas.prototype), {
    walls: [wall('a', 'room-a'), wall('b', 'room-b')],
    controller: { getActiveRoomId: () => 'room-b' },
    rooms: [],
    selectedRoomId: 'room-a',
    zoomLevel: 1,
  });
}

for (const [roomIndex, label, deltaY] of [
  [0, 'W3.2', 40],
  [1, 'W3.1', -40],
])
  for (const type of ['move', 'resize'])
    test(`a ${type} reaches its full endpoint across junction reconstruction (${label})`, async () => {
      const f = planFixture();
      let record = f.record;
      const before = readBuildingPlanRecord({ meta: f.meta, record });
      const controller = new BuildingPlanCanvasController({
        meta: f.meta,
        readRecord: () => record,
        writeRecord: (next) => {
          record = next;
        },
        editingPolicy: { snapping: false },
      });
      const c = Object.assign(Object.create(BuildingPlanCanvas.prototype), {
        controller,
        mode: 'select',
        gridSize: 20,
        zoomLevel: 1,
        getCanvasPoint: (event) => event,
        render() {},
        updateCursor() {},
        updateButtonStates() {},
      });
      const unsubscribe = controller.subscribe((scene) => {
        c.walls = scene.walls;
        c.rooms = scene.rooms;
      });
      try {
        const selected = c.walls.find(
          (wall) =>
            wall.roomId === before.floors[0].rooms[roomIndex].id && wall.displayLabel === label
        );
        assert.ok(selected);
        const original = structuredClone(selected.points);
        const pointerStart =
          type === 'resize'
            ? original.at(-1)
            : {
                x: (original[0].x + original[1].x) / 2,
                y: original[0].y,
              };
        c.wallDragState = {
          type,
          wallId: selected.id,
          physicalWallId: selected.physicalWallId,
          handleIndex: original.length - 1,
          originalPoints: original,
          pointerStart,
          moved: false,
        };
        c.lastPointerEvent = { altKey: true };
        controller.interaction.begin();
        let rebuilt = false;
        for (let step = 1; step <= 40; step++) {
          c.handleMouseMove({ x: pointerStart.x, y: pointerStart.y + (deltaY * step) / 40 });
          if (!c.wallDragState.previewPoints) continue;
          const result = controller.previewWall(selected.id, c.wallDragState.previewPoints);
          assert.equal(result.status, 'ready', JSON.stringify(result.issues));
          rebuilt ||=
            c.rooms[roomIndex].vertices.length > before.floors[0].rooms[roomIndex].vertices.length;
        }
        assert.ok(rebuilt, 'This case must rebuild the junction while dragging');
        assert.equal(c.wallDragState.previewPoints[0].y, original[0].y + deltaY);
        assert.deepEqual(
          readBuildingPlanRecord({ meta: f.meta, record }),
          before,
          'Preview must not accept geometry'
        );
        assert.ok(
          [...controller.walls.values()].every((wall) => !Object.hasOwn(wall, 'previewPoints'))
        );
        await c.handleMouseUp({ x: pointerStart.x, y: pointerStart.y + deltaY });
        const after = readBuildingPlanRecord({ meta: f.meta, record });
        const ys = after.floors[0].rooms[roomIndex].vertices.map((point) => point.y);
        assert.equal(deltaY > 0 ? Math.max(...ys) : Math.min(...ys), (original[0].y + deltaY) / 20);
        assert.equal(c.wallDragState, null);
        for (const point of before.floors[0].rooms[1 - roomIndex].vertices)
          assert.deepEqual(
            after.floors[0].rooms[1 - roomIndex].vertices.find((other) => other.id === point.id),
            point
          );
      } finally {
        unsubscribe();
        controller.dispose();
      }
    });

test('wall previews stay in the view and pointer release ends the gesture before a managed decision', async () => {
  const c = canvas();
  c.mode = 'select';
  c.gridSize = 20;
  c.rooms = [{ id: 'room-a', rect: { x: 0, y: 0, width: 200, height: 100 } }];
  const accepted = structuredClone(c.walls[0]);
  c.controller.walls = new Map([['a', accepted]]);
  c.controller.canEdit = () => true;
  c.controller.interaction = { snapWallTranslation: (points) => points };
  c.wallDragState = {
    type: 'move',
    wallId: 'a',
    pointerStart: { x: 0, y: 0 },
    originalPoints: structuredClone(accepted.points),
    moved: false,
  };
  c.getCanvasPoint = (point) => point;
  c.render = c.updateButtonStates = c.updateCursor = () => {};
  c.handleMouseMove({ x: 40, y: 0 });
  assert.equal(
    accepted.previewPoints,
    undefined,
    'The controller scene is immutable to UI gestures'
  );
  c.walls = [{ ...structuredClone(accepted), id: 'replacement-facing-row' }];
  c.handleMouseMove({ x: 60, y: 0 });
  assert.equal(
    c.wallDragState.previewPoints[0].x,
    60,
    'A missing preview row must not truncate the gesture'
  );
  assert.equal(accepted.previewPoints, undefined);
  let finish;
  c.controller.updateWall = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const completed = c.handleMouseUp({ x: 60, y: 0 });
  assert.equal(c.wallDragState, null, 'A pending question must not keep a released gesture alive');
  c.walls = [structuredClone(accepted)]; // A managed reply replaces the projected objects.
  finish(null);
  await completed;
  assert.equal(c.walls[0].previewPoints, undefined);
  assert.deepEqual(accepted.points, wall('a', 'room-a').points);
});
test('coincident wall portions and handles prefer the room being edited', () => {
  const c = canvas();
  assert.equal(c.findWallNearPoint({ x: 50, y: 0 }).wall.id, 'b');
  assert.equal(c.findWallHandle({ x: 0, y: 0 }).wall.id, 'b');
  assert.equal(c.findWallNearPoint({ x: 50, y: 0 }, 'room-a').wall.id, 'a');
  c.walls[1].points = [
    { x: 0, y: 20 },
    { x: 100, y: 20 },
  ];
  assert.equal(
    c.findWallNearPoint({ x: 50, y: 0 }).wall.id,
    'a',
    'Other rooms remain reachable outside an ambiguous hit.'
  );
});
test('canonical opening geometry lies in the physical wall, keeping room-relative edit ratios', () => {
  const c = canvas();
  c.gridSize = 20;
  c.walls[0].axisPoints = [
    { x: 0, y: 2 },
    { x: 100, y: 2 },
  ];
  const opening = {
    wallId: 'a',
    startRatio: 0.2,
    endRatio: 0.4,
    width: 1,
    physical: { thickness: 0.2 },
  };
  const g = c.getOpeningGeometry(opening);
  assert.deepEqual(g.startPoint, { x: 20, y: 2 });
  assert.deepEqual(g.endPoint, { x: 40, y: 2 });
  const preview = c.getOpeningGeometry(opening, { startRatio: 0.3, endRatio: 0.5 });
  assert.deepEqual(preview.startPoint, { x: 30, y: 2 });
});

test('one shared opening is drawn once using the active room projection', () => {
  const c = canvas();
  c.doors = [
    { id: 'a-door', subjectId: 'shared', roomId: 'room-a' },
    { id: 'b-door', subjectId: 'shared', roomId: 'room-b' },
  ];
  c.windows = [];
  const drawn = [];
  c.drawOpening = (opening) => drawn.push(opening.id);
  c.drawOpenings();
  assert.deepEqual(drawn, ['b-door']);
});

test('thick material is selectable only over the selected facing extent', () => {
  const c = canvas();
  c.walls[0] = {
    ...wall('a', 'room-a'),
    physicalWallId: 'physical',
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
  };
  c.walls[1] = {
    ...wall('b', 'room-b'),
    physicalWallId: 'physical',
    points: [
      { x: 30, y: 20 },
      { x: 100, y: 20 },
    ],
  };
  c.wallFootprints = [
    {
      id: 'physical',
      polygons: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 20 },
          { x: 0, y: 20 },
        ],
      ],
    },
  ];
  assert.equal(c.findWallNearPoint({ x: 60, y: 10 }).wall.id, 'b');
  assert.equal(c.findWallNearPoint({ x: 15, y: 10 }).wall.id, 'a');
});

test('another room resize handle cannot hide an active room jog portion', () => {
  const c = canvas();
  c.rooms = [{ id: 'room-a', rect: { x: 0, y: 0, width: 100, height: 72 } }];
  c.walls = [
    {
      ...wall('a', 'room-a'),
      points: [
        { x: 100, y: 0 },
        { x: 100, y: 72 },
      ],
    },
    {
      ...wall('b', 'room-b'),
      points: [
        { x: 100, y: 64 },
        { x: 100, y: 76 },
      ],
    },
  ];
  assert.equal(c.findRoomHandle({ x: 100, y: 68 }), null);
  assert.equal(c.findWallHandle({ x: 100, y: 68 }).wall.id, 'b');
});

test('a click near a jog handle does not become a resize without pointer movement', () => {
  const c = canvas();
  c.mode = 'select';
  c.rooms = [{ id: 'room-b', rect: { x: 0, y: 0, width: 100, height: 100 } }];
  c.walls = [
    {
      ...wall('b', 'room-b'),
      points: [
        { x: 100, y: 76 },
        { x: 100, y: 64 },
      ],
    },
  ];
  c.wallDragState = {
    type: 'resize',
    wallId: 'b',
    handleIndex: 1,
    pointerStart: { x: 100, y: 68 },
    originalPoints: c.walls[0].points,
    moved: false,
  };
  c.getCanvasPoint = (point) => point;
  c.handleMouseMove({ x: 100, y: 68 });
  assert.equal(c.wallDragState.moved, false);
  assert.equal(c.wallDragState.previewPoints, undefined);
});
