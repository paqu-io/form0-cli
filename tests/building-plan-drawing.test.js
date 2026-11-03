import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvas } from '../src/server/static/building-plan-canvas.js';

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
