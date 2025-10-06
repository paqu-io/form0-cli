const MODE_SELECT = 'select';
const MODE_DRAW_ROOM = 'draw-room';
const MODE_DRAW_WALL = 'draw-wall';

const DEFAULT_GRID_SIZE = 20;
const SNAP_RADIUS = 10;
const WALL_HIT_TOLERANCE = 6;
const ROOM_HANDLE_SIZE = 6;
const ROOM_HANDLE_HIT_SIZE = 12;
const WALL_HANDLE_HIT_RADIUS = 8;
const ROUND_DECIMALS = 3;

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clonePoints(points = []) {
  return Array.isArray(points) ? points.map((point) => ({ ...point })) : [];
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return distance(point, a);

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
  if (t < 0) return distance(point, a);
  if (t > 1) return distance(point, b);
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundCoordinate(value, decimals = ROUND_DECIMALS) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundPointValues(point, decimals = ROUND_DECIMALS) {
  if (!point) return { x: 0, y: 0 };
  return {
    x: roundCoordinate(point.x, decimals),
    y: roundCoordinate(point.y, decimals),
  };
}

function roundRectValues(rect, decimals = ROUND_DECIMALS) {
  if (!rect) return null;
  return {
    x: roundCoordinate(rect.x, decimals),
    y: roundCoordinate(rect.y, decimals),
    width: roundCoordinate(rect.width, decimals),
    height: roundCoordinate(rect.height, decimals),
  };
}

function roundPoints(points, decimals = ROUND_DECIMALS) {
  return Array.isArray(points) ? points.map((point) => roundPointValues(point, decimals)) : [];
}

export class BuildingPlanCanvas {
  constructor({ container, controller }) {
    this.container = container;
    this.controller = controller;

    this.mode = MODE_SELECT;
    this.rooms = [];
    this.walls = [];
    this.floors = [];
    this.activeFloorIndex = 0;
    this.hasFloors = false;
    this.selectedRoomId = null;
    this.selectedWallId = null;

    this.dragState = null;
    this.wallDragState = null;
    this.wallDraft = null;
    this.roomDraft = null;
    this.hoverState = null;

    this.gridSize = DEFAULT_GRID_SIZE;

    this.unsubscribe = null;
    this.floorTabsContainer = null;

    this.buildUI();
    this.attachEvents();
    this.subscribeToController();
    this.render();
  }

  destroy() {
    window.removeEventListener('resize', this.boundResizeHandler);
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch (err) {
        console.error('[BuildingPlan] Resize observer disconnect error', err);
      }
      this.resizeObserver = null;
    }
    if (this.canvas) {
      this.canvas.removeEventListener('mousedown', this.boundMouseDown);
      this.canvas.removeEventListener('mousemove', this.boundMouseMove);
      window.removeEventListener('mouseup', this.boundMouseUp);
      this.canvas.removeEventListener('mouseleave', this.boundMouseLeave);
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  buildUI() {
    this.container.innerHTML = '';
    this.container.classList.add('building-plan-canvas-wrapper');

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'building-plan-toolbar';

    this.selectButton = this.createToolbarButton('Select / Move', MODE_SELECT);
    this.floorButton = document.createElement('button');
    this.floorButton.type = 'button';
    this.floorButton.className = 'building-plan-toolbar-button';
    this.floorButton.textContent = 'Draw Floor';
    this.floorButton.addEventListener('click', () => {
      if (this.controller && typeof this.controller.createFloor === 'function') {
        this.controller.createFloor();
      }
    });
    this.roomButton = this.createToolbarButton('Draw Room', MODE_DRAW_ROOM);
    this.wallButton = this.createToolbarButton('Draw Wall', MODE_DRAW_WALL);

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'building-plan-toolbar-button';
    this.clearButton.textContent = 'Clear Selection';
    this.clearButton.addEventListener('click', () => this.clearSelection());

    this.toolbar.appendChild(this.selectButton);
    this.toolbar.appendChild(this.floorButton);
    this.toolbar.appendChild(this.roomButton);
    this.toolbar.appendChild(this.wallButton);
    this.toolbar.appendChild(this.clearButton);

    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'building-plan-canvas-container';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'building-plan-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.canvasContainer.appendChild(this.canvas);

    this.floorTabsContainer = document.createElement('div');
    this.floorTabsContainer.className = 'building-plan-floor-tabs';
    this.container.appendChild(this.floorTabsContainer);

    this.container.appendChild(this.toolbar);
    this.container.appendChild(this.canvasContainer);

    this.renderFloorTabs();

    this.boundResizeHandler = () => this.resizeCanvas();
    window.addEventListener('resize', this.boundResizeHandler);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.canvasContainer);
    }

    this.resizeCanvas();
    this.updateCursor();
    this.updateButtonStates();
  }

  createToolbarButton(label, mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'building-plan-toolbar-button';
    button.addEventListener('click', () => {
      this.setMode(mode);
    });
    if (mode === this.mode) {
      button.classList.add('active');
    }
    return button;
  }

  setMode(mode) {
    if (mode === MODE_DRAW_ROOM && this.roomButton && this.roomButton.disabled) {
      return;
    }
    if (mode === MODE_DRAW_WALL && this.wallButton && this.wallButton.disabled) {
      return;
    }
    this.mode = mode;
    this.selectButton.classList.toggle('active', mode === MODE_SELECT);
    this.roomButton.classList.toggle('active', mode === MODE_DRAW_ROOM);
    this.wallButton.classList.toggle('active', mode === MODE_DRAW_WALL);
    this.wallDraft = null;
    this.roomDraft = null;
    this.dragState = null;
    this.wallDragState = null;
    this.hoverState = null;
    this.updateCursor();
    this.updateButtonStates();
    this.render();
  }

  attachEvents() {
    this.boundMouseDown = (event) => this.handleMouseDown(event);
    this.boundMouseMove = (event) => this.handleMouseMove(event);
    this.boundMouseUp = (event) => this.handleMouseUp(event);
    this.boundMouseLeave = () => this.handleMouseLeave();

    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mouseup', this.boundMouseUp);
    this.canvas.addEventListener('mouseleave', this.boundMouseLeave);
  }

  subscribeToController() {
    if (!this.controller) return;
    this.unsubscribe = this.controller.subscribe((snapshot) => {
      const prevActiveFloor = this.activeFloorIndex;
      const prevFloorCount = this.floors ? this.floors.length : 0;

      this.rooms = snapshot.rooms || [];
      this.walls = snapshot.walls || [];
      this.floors = snapshot.floors || [];
      this.activeFloorIndex =
        typeof snapshot.activeFloorIndex === 'number' ? snapshot.activeFloorIndex : 0;
      this.hasFloors = this.floors.length > 0;

      if (prevActiveFloor !== this.activeFloorIndex || prevFloorCount !== this.floors.length) {
        this.selectedRoomId = null;
        this.selectedWallId = null;
        this.wallDragState = null;
      } else {
        if (this.selectedRoomId && !this.rooms.find((room) => room.id === this.selectedRoomId)) {
          this.selectedRoomId = null;
        }
        if (this.selectedWallId && !this.walls.find((wall) => wall.id === this.selectedWallId)) {
          this.selectedWallId = null;
        }
      }

      this.renderFloorTabs();
      this.updateCursor();
      this.updateButtonStates();
      this.render();
    });
  }

  updateCursor() {
    if (!this.canvas) return;
    if (this.mode !== MODE_SELECT) {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    if (this.dragState) {
      if (this.dragState.type === 'resize') {
        this.canvas.style.cursor = this.getCursorForHandle(this.dragState.handle);
        return;
      }
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this.wallDragState) {
      if (this.wallDragState.type === 'resize') {
        this.canvas.style.cursor = 'crosshair';
        return;
      }
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const hover = this.hoverState;
    if (hover && hover.type === 'room-handle') {
      this.canvas.style.cursor = this.getCursorForHandle(hover.handle);
      return;
    }
    if (hover && hover.type === 'wall-handle') {
      this.canvas.style.cursor = 'crosshair';
      return;
    }

    this.canvas.style.cursor = 'grab';
  }

  resizeCanvas() {
    const rect = this.canvasContainer.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.render();
  }

  clearSelection() {
    this.selectedRoomId = null;
    this.selectedWallId = null;
    this.wallDragState = null;
    this.hoverState = null;
    this.rooms.forEach((room) => {
      if (room.previewRect) delete room.previewRect;
    });
    this.walls.forEach((wall) => {
      if (wall.previewPoints) delete wall.previewPoints;
    });
    this.updateCursor();
    this.updateButtonStates();
    this.render();
  }

  handleMouseDown(event) {
    const point = this.getCanvasPoint(event);

    if (this.mode === MODE_SELECT) {
      const roomHandleHit = this.findRoomHandle(point);
      if (roomHandleHit && roomHandleHit.room) {
        const { room, handle } = roomHandleHit;
        const rect = room.previewRect || room.rect;
        if (rect) {
          this.selectedRoomId = room.id;
          this.selectedWallId = null;
          this.dragState = {
            type: 'resize',
            roomId: room.id,
            handle,
            baseRect: { ...rect },
            pointerStart: point,
            moved: false,
          };
          this.setHoverState(null);
          this.controller?.focusRoom(room.id);
          this.updateButtonStates();
          this.updateCursor();
          this.render();
          return;
        }
      }

      const wallHandleHit = this.findWallHandle(point);
      if (wallHandleHit && wallHandleHit.wall) {
        const { wall, index } = wallHandleHit;
        const basePoints =
          wall.previewPoints && wall.previewPoints.length > 0
            ? clonePoints(wall.previewPoints)
            : clonePoints(wall.points);
        this.selectedRoomId = wall.roomId;
        this.selectedWallId = wall.id;
        this.wallDragState = {
          type: 'resize',
          wallId: wall.id,
          handleIndex: index,
          originalPoints: basePoints,
          pointerStart: point,
          moved: false,
        };
        this.setHoverState(null);
        this.controller?.focusWall(wall.id);
        this.updateButtonStates();
        this.updateCursor();
        this.render();
        return;
      }
    }

    if (this.mode === MODE_DRAW_ROOM) {
      if (!this.hasFloors) {
        return;
      }
      this.roomDraft = { start: point, current: point };
      this.render();
      return;
    }

    if (this.mode === MODE_DRAW_WALL) {
      if (!this.selectedRoomId) {
        return;
      }
      const room = this.findRoomAtPoint(point);
      if (!room || room.id !== this.selectedRoomId) {
        this.wallDraft = null;
        return;
      }

      const snapStart = this.snapToRoomEdges(point, room);
      this.wallDraft = { roomId: room.id, start: snapStart, end: snapStart };
      this.render();
      return;
    }

    const wall = this.findWallNearPoint(point);
    const room = this.findRoomAtPoint(point);

    if (this.mode === MODE_SELECT && wall) {
      const basePoints =
        wall.previewPoints && wall.previewPoints.length > 0
          ? clonePoints(wall.previewPoints)
          : clonePoints(wall.points);
      this.selectedRoomId = wall.roomId;
      this.selectedWallId = wall.id;
      this.wallDragState = {
        type: 'move',
        wallId: wall.id,
        pointerStart: point,
        originalPoints: basePoints,
        moved: false,
      };
      this.setHoverState(null);
      this.controller?.focusWall(wall.id);
      this.updateButtonStates();
      this.updateCursor();
      this.render();
      return;
    }

    if (room) {
      this.selectedRoomId = room.id;
      this.selectedWallId = null;
      this.dragState = {
        type: 'move',
        roomId: room.id,
        offsetX: point.x - room.rect.x,
        offsetY: point.y - room.rect.y,
      };
      this.setHoverState(null);
      this.controller?.focusRoom(room.id);
      this.updateButtonStates();
      this.updateCursor();
      this.render();
      return;
    }

    this.clearSelection();
  }

  handleMouseMove(event) {
    const point = this.getCanvasPoint(event);

    if (
      this.mode === MODE_SELECT &&
      !this.dragState &&
      !this.wallDragState &&
      !this.roomDraft &&
      !this.wallDraft
    ) {
      const roomHandle = this.findRoomHandle(point);
      if (roomHandle) {
        this.setHoverState({
          type: 'room-handle',
          handle: roomHandle.handle,
          roomId: roomHandle.room.id,
        });
      } else {
        const wallHandle = this.findWallHandle(point);
        if (wallHandle) {
          this.setHoverState({
            type: 'wall-handle',
            handle: wallHandle.index === 0 ? 'start' : 'end',
            wallId: wallHandle.wall.id,
          });
        } else {
          this.setHoverState(null);
        }
      }
    }

    if (this.mode === MODE_DRAW_ROOM && this.roomDraft) {
      this.roomDraft.current = point;
      this.render();
      return;
    }

    if (this.mode === MODE_DRAW_WALL && this.wallDraft) {
      const room = this.rooms.find((r) => r.id === this.wallDraft.roomId);
      if (!room) return;
      this.wallDraft.end = this.snapToRoomEdges(point, room);
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.dragState) {
      const state = this.dragState;
      const room = this.rooms.find((r) => r.id === state.roomId);
      if (!room) return;

      if (state.type === 'move') {
        const width = room.rect.width;
        const height = room.rect.height;
        const snappedOrigin = this.snapPoint({
          x: point.x - state.offsetX,
          y: point.y - state.offsetY,
        });
        const newRect = roundRectValues({
          x: snappedOrigin.x,
          y: snappedOrigin.y,
          width,
          height,
        });

        this.previewRoomMovement(room.id, newRect);
      } else if (state.type === 'resize') {
        const snappedPoint = this.snapPoint(point);
        const newRect = this.computeResizedRect(state.baseRect, state.handle, snappedPoint);
        if (newRect) {
          state.moved =
            state.moved ||
            newRect.x !== state.baseRect.x ||
            newRect.y !== state.baseRect.y ||
            newRect.width !== state.baseRect.width ||
            newRect.height !== state.baseRect.height;
          const roundedRect = roundRectValues(newRect);
          this.previewRoomMovement(room.id, roundedRect);
          state.previewRect = roundedRect;
        }
      }

      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.wallDragState) {
      const wall = this.walls.find((w) => w.id === this.wallDragState.wallId);
      if (!wall) return;
      const room = this.rooms.find((r) => r.id === wall.roomId);
      if (!room || !room.rect) return;

      const state = this.wallDragState;

      if (state.type === 'move') {
        const deltaX = point.x - state.pointerStart.x;
        const deltaY = point.y - state.pointerStart.y;

        if (!state.moved && Math.abs(deltaX) + Math.abs(deltaY) > 1) {
          state.moved = true;
        }

        const newPoints = state.originalPoints.map((pt) => {
          const translated = {
            x: pt.x + deltaX,
            y: pt.y + deltaY,
          };
          const clamped = {
            x: clamp(translated.x, room.rect.x, room.rect.x + room.rect.width),
            y: clamp(translated.y, room.rect.y, room.rect.y + room.rect.height),
          };
          return this.snapPoint(clamped);
        });

        const roundedPoints = roundPoints(newPoints);
        wall.previewPoints = roundedPoints;
        state.previewPoints = roundedPoints;
      } else if (state.type === 'resize') {
        const snappedPoint = this.snapToRoomEdges(point, room);
        const newPoints = state.originalPoints.map((pt, idx) =>
          idx === state.handleIndex ? { ...snappedPoint } : { ...pt }
        );

        const basePoint = state.originalPoints[state.handleIndex];
        if (
          !state.moved &&
          (basePoint.x !== snappedPoint.x || basePoint.y !== snappedPoint.y)
        ) {
          state.moved = true;
        }

        const roundedPoints = roundPoints(newPoints);
        wall.previewPoints = roundedPoints;
        state.previewPoints = roundedPoints;
      }

      this.render();
      return;
    }
  }

  handleMouseUp(event) {
    const point = this.getCanvasPoint(event);

    if (this.mode === MODE_DRAW_ROOM && this.roomDraft) {
      const rect = this.normalizeRectangle(this.roomDraft.start, point);
      this.roomDraft = null;

      if (rect.width >= 5 && rect.height >= 5) {
        const snapped = {
          x: this.snapCoordinate(rect.x),
          y: this.snapCoordinate(rect.y),
          width: this.snapSize(rect.width),
          height: this.snapSize(rect.height),
        };
        const created = this.controller?.createRoom(snapped);
        if (created) {
          this.selectedRoomId = created.id;
          this.controller?.focusRoom(created.id);
        }
      }

      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }

    if (this.mode === MODE_DRAW_WALL && this.wallDraft) {
      const room = this.rooms.find((r) => r.id === this.wallDraft.roomId);
      if (room) {
        const endPoint = this.snapToRoomEdges(point, room);
        if (distance(this.wallDraft.start, endPoint) > 3) {
          const wallPoints = roundPoints([this.wallDraft.start, endPoint]);
          const created = this.controller?.createWall(room.id, wallPoints);
          if (created) {
            this.selectedWallId = created.id;
            this.controller?.focusWall(created.id);
          }
        }
      }
      this.wallDraft = null;
      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.dragState) {
      const state = this.dragState;
      const room = this.rooms.find((r) => r.id === state.roomId);
      if (room) {
        const commitRect = room.previewRect || room.rect;
        if (commitRect && (state.type !== 'resize' || state.moved)) {
          this.controller?.updateRoom(room.id, commitRect);
        }
      }
      this.dragState = null;
      this.rooms.forEach((r) => delete r.previewRect);
      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.wallDragState) {
      const state = this.wallDragState;
      const wall = this.walls.find((w) => w.id === state.wallId);
      if (wall && state.previewPoints && state.moved) {
        this.controller?.updateWall(wall.id, state.previewPoints);
      }
      if (wall) {
        delete wall.previewPoints;
      }
      this.wallDragState = null;
      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }
  }

  handleMouseLeave() {
    if (this.mode === MODE_DRAW_ROOM) {
      this.roomDraft = null;
    }
    if (this.mode === MODE_DRAW_WALL) {
      this.wallDraft = null;
    }
    if (this.mode === MODE_SELECT) {
      this.rooms.forEach((r) => delete r.previewRect);
      this.dragState = null;
      if (this.wallDragState) {
        const wall = this.walls.find((w) => w.id === this.wallDragState.wallId);
        if (wall) {
          delete wall.previewPoints;
        }
        this.wallDragState = null;
      }
      this.setHoverState(null);
    }
    this.updateCursor();
    this.updateButtonStates();
    this.render();
  }

  getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  normalizeRectangle(start, end) {
    const x1 = start.x;
    const y1 = start.y;
    const x2 = end.x;
    const y2 = end.y;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  snapCoordinate(value) {
    return Math.round(value / this.gridSize) * this.gridSize;
  }

  snapSize(value) {
    return Math.max(this.gridSize, Math.round(value / this.gridSize) * this.gridSize);
  }

  snapPoint(point) {
    const snapped = {
      x: this.snapCoordinate(point.x),
      y: this.snapCoordinate(point.y),
    };

    let bestPoint = snapped;
    let bestDistance = SNAP_RADIUS + 1;

    this.rooms.forEach((room) => {
      const vertices = room.rect
        ? [
            { x: room.rect.x, y: room.rect.y },
            { x: room.rect.x + room.rect.width, y: room.rect.y },
            { x: room.rect.x, y: room.rect.y + room.rect.height },
            { x: room.rect.x + room.rect.width, y: room.rect.y + room.rect.height },
          ]
        : [];

      vertices.forEach((vertex) => {
        const dist = distance(vertex, point);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestPoint = { x: vertex.x, y: vertex.y };
        }
      });
    });

    return roundPointValues(bestPoint);
  }

  snapToRoomEdges(point, room) {
    const rect = room.rect;
    if (!rect) return this.snapPoint(point);

    const snapped = this.snapPoint(point);
    const insideX = snapped.x >= rect.x && snapped.x <= rect.x + rect.width;
    const insideY = snapped.y >= rect.y && snapped.y <= rect.y + rect.height;

    const clamped = {
      x: clamp(snapped.x, rect.x, rect.x + rect.width),
      y: clamp(snapped.y, rect.y, rect.y + rect.height),
    };

    const vertices = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ];

    let bestVertex = null;
    let bestDistance = SNAP_RADIUS;

    vertices.forEach((vertex) => {
      const dist = distance(vertex, snapped);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestVertex = vertex;
      }
    });

    if (bestVertex) {
      return roundPointValues(bestVertex);
    }

    const edgeOptions = [];
    if (insideY) {
      edgeOptions.push({ point: { x: rect.x, y: snapped.y }, dist: Math.abs(snapped.x - rect.x) });
      edgeOptions.push({ point: { x: rect.x + rect.width, y: snapped.y }, dist: Math.abs(snapped.x - (rect.x + rect.width)) });
    }
    if (insideX) {
      edgeOptions.push({ point: { x: snapped.x, y: rect.y }, dist: Math.abs(snapped.y - rect.y) });
      edgeOptions.push({ point: { x: snapped.x, y: rect.y + rect.height }, dist: Math.abs(snapped.y - (rect.y + rect.height)) });
    }

    const nearestEdge = edgeOptions.sort((a, b) => a.dist - b.dist)[0];
    if (nearestEdge && nearestEdge.dist < SNAP_RADIUS) {
      return roundPointValues(nearestEdge.point);
    }

    if (!insideX || !insideY) {
      return roundPointValues(clamped);
    }

    return roundPointValues(snapped);
  }

  findRoomAtPoint(point) {
    for (let i = this.rooms.length - 1; i >= 0; i -= 1) {
      const room = this.rooms[i];
      const rect = room.previewRect || room.rect;
      if (!rect) continue;
      if (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      ) {
        return room;
      }
    }
    return null;
  }

  getRoomHandlePositions(rect) {
    if (!rect) return {};
    return {
      'top-left': { x: rect.x, y: rect.y },
      'top-right': { x: rect.x + rect.width, y: rect.y },
      'bottom-right': { x: rect.x + rect.width, y: rect.y + rect.height },
      'bottom-left': { x: rect.x, y: rect.y + rect.height },
    };
  }

  findRoomHandle(point) {
    if (!point) return null;
    const hitOffset = ROOM_HANDLE_HIT_SIZE / 2;
    for (let i = this.rooms.length - 1; i >= 0; i -= 1) {
      const room = this.rooms[i];
      const rect = room.previewRect || room.rect;
      if (!rect) continue;
      const handles = this.getRoomHandlePositions(rect);
      const entries = Object.entries(handles);
      for (let j = 0; j < entries.length; j += 1) {
        const [key, handlePoint] = entries[j];
        if (
          Math.abs(point.x - handlePoint.x) <= hitOffset &&
          Math.abs(point.y - handlePoint.y) <= hitOffset
        ) {
          return { room, handle: key, handlePoint };
        }
      }
    }
    return null;
  }

  findWallNearPoint(point) {
    let candidate = null;
    let best = WALL_HIT_TOLERANCE;

    this.walls.forEach((wall) => {
      const renderedPoints = this.getRenderedWallPoints(wall);
      if (!Array.isArray(renderedPoints) || renderedPoints.length < 2) return;
      const distanceToSegment = pointToSegmentDistance(point, renderedPoints[0], renderedPoints[1]);
      if (distanceToSegment < best) {
        best = distanceToSegment;
        candidate = wall;
      }
    });

    return candidate;
  }

  findWallHandle(point) {
    if (!point) return null;
    const testWalls = [];
    if (this.selectedWallId) {
      const selected = this.walls.find((wall) => wall.id === this.selectedWallId);
      if (selected) {
        testWalls.push(selected);
      }
    }
    this.walls.forEach((wall) => {
      if (!this.selectedWallId || wall.id !== this.selectedWallId) {
        testWalls.push(wall);
      }
    });

    for (let i = 0; i < testWalls.length; i += 1) {
      const wall = testWalls[i];
      const points = this.getRenderedWallPoints(wall);
      if (!Array.isArray(points) || points.length < 2) continue;
      for (let index = 0; index < 2; index += 1) {
        const handlePoint = points[index];
        const dist = distance(point, handlePoint);
        if (dist <= WALL_HANDLE_HIT_RADIUS) {
          return { wall, index, handlePoint };
        }
      }
    }
    return null;
  }

  setHoverState(nextState) {
    const prev = this.hoverState;
    const same =
      prev &&
      nextState &&
      prev.type === nextState.type &&
      prev.handle === nextState.handle &&
      prev.wallId === nextState.wallId &&
      prev.roomId === nextState.roomId;
    if (same) return;
    if (!prev && !nextState) return;
    this.hoverState = nextState || null;
    this.updateCursor();
  }

  computeResizedRect(baseRect, handle, pointer) {
    if (!baseRect || !handle || !pointer) return null;
    const minSize = this.gridSize;

    let left = baseRect.x;
    let right = baseRect.x + baseRect.width;
    let top = baseRect.y;
    let bottom = baseRect.y + baseRect.height;

    switch (handle) {
      case 'top-left':
        left = Math.min(pointer.x, right - minSize);
        top = Math.min(pointer.y, bottom - minSize);
        break;
      case 'top-right':
        right = Math.max(pointer.x, left + minSize);
        top = Math.min(pointer.y, bottom - minSize);
        break;
      case 'bottom-right':
        right = Math.max(pointer.x, left + minSize);
        bottom = Math.max(pointer.y, top + minSize);
        break;
      case 'bottom-left':
        left = Math.min(pointer.x, right - minSize);
        bottom = Math.max(pointer.y, top + minSize);
        break;
      default:
        return null;
    }

    const rect = {
      x: left,
      y: top,
      width: Math.max(minSize, right - left),
      height: Math.max(minSize, bottom - top),
    };
    return roundRectValues(rect);
  }

  getCursorForHandle(handle) {
    switch (handle) {
      case 'top-left':
      case 'bottom-right':
        return 'nwse-resize';
      case 'top-right':
      case 'bottom-left':
        return 'nesw-resize';
      default:
        return 'default';
    }
  }

  previewRoomMovement(roomId, newRect) {
    const roundedRect = newRect ? roundRectValues(newRect) : null;
    let targetRoom = null;
    this.rooms.forEach((room) => {
      if (room.id === roomId && roundedRect) {
        room.previewRect = roundedRect;
        targetRoom = room;
      } else {
        delete room.previewRect;
      }
    });

    const targetRect = roundedRect || newRect;

    this.walls.forEach((wall) => {
      if (!targetRoom || !targetRect || wall.roomId !== roomId) {
        delete wall.previewPoints;
        return;
      }

      const fromRect = targetRoom.rect;
      const toRect = targetRect;
      const fromWidth = fromRect.width || 1;
      const fromHeight = fromRect.height || 1;

      const previewPoints = (wall.points || []).map((point) => {
        const relativeX = fromWidth === 0 ? 0 : (point.x - fromRect.x) / fromWidth;
        const relativeY = fromHeight === 0 ? 0 : (point.y - fromRect.y) / fromHeight;
        return {
          x: toRect.x + relativeX * toRect.width,
          y: toRect.y + relativeY * toRect.height,
        };
      });
      wall.previewPoints = roundPoints(previewPoints);
    });
  }

  render() {
    if (!this.ctx) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGrid();

    if (!this.hasFloors) {
      this.drawNoFloorOverlay();
      return;
    }

    this.rooms.forEach((room) => this.drawRoom(room));

    this.walls.forEach((wall) => this.drawWall(wall));

    if (this.wallDraft && this.wallDraft.start && this.wallDraft.end) {
      this.drawDraftWall(this.wallDraft.start, this.wallDraft.end);
    }

    if (this.roomDraft) {
      const rect = this.normalizeRectangle(this.roomDraft.start, this.roomDraft.current);
      const snapped = {
        x: this.snapCoordinate(rect.x),
        y: this.snapCoordinate(rect.y),
        width: this.snapSize(rect.width),
        height: this.snapSize(rect.height),
      };
      this.drawDraftRoom(snapped);
    }
  }

  renderFloorTabs() {
    if (!this.floorTabsContainer) return;
    this.floorTabsContainer.innerHTML = '';

    if (!this.floors || this.floors.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'building-plan-floor-placeholder';
      placeholder.textContent = 'Add a floor to enable drawing';
      this.floorTabsContainer.appendChild(placeholder);
      return;
    }

    this.floors.forEach((floor) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = floor.label || 'Floor #' + (floor.index + 1);
      button.className = 'building-plan-floor-tab';
      if (floor.index === this.activeFloorIndex) {
        button.classList.add('active');
      }
      button.addEventListener('click', () => this.handleFloorTabClick(floor.index));
      this.floorTabsContainer.appendChild(button);
    });
  }

  handleFloorTabClick(index) {
    if (index === this.activeFloorIndex) {
      return;
    }
    this.selectedRoomId = null;
    this.selectedWallId = null;
    this.wallDragState = null;
    this.activeFloorIndex = index;
    this.renderFloorTabs();
    if (this.controller && typeof this.controller.setActiveFloor === 'function') {
      this.controller.setActiveFloor(index);
    }
    this.updateButtonStates();
    this.updateCursor();
    this.render();
  }

  updateButtonStates() {
    const hasFloors = this.hasFloors;
    const hasSelectedRoom = Boolean(this.selectedRoomId);

    if (this.floorButton) {
      const canCreateFloor = Boolean(this.controller && typeof this.controller.createFloor === 'function');
      this.floorButton.disabled = !canCreateFloor;
      this.floorButton.title = canCreateFloor ? 'Add a new floor' : 'Floor creation unavailable';
    }

    if (this.roomButton) {
      this.roomButton.disabled = !hasFloors;
      this.roomButton.title = hasFloors
        ? 'Draw a new room'
        : 'Add a floor to enable room drawing';
    }

    if (this.wallButton) {
      this.wallButton.disabled = !hasFloors || !hasSelectedRoom;
      if (!hasFloors) {
        this.wallButton.title = 'Add a floor to enable wall drawing';
      } else if (!hasSelectedRoom) {
        this.wallButton.title = 'Select a room to draw walls';
      } else {
        this.wallButton.title = 'Draw a wall for the selected room';
      }
    }
  }

  drawNoFloorOverlay() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Add a floor to enable the canvas tools', this.canvas.width / 2, this.canvas.height / 2);
    ctx.restore();
  }

  drawGrid() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#e6e6e6';
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += this.gridSize) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y += this.gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#9fb3d9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, height);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(width, 0.5);
    ctx.stroke();

    ctx.fillStyle = '#55607a';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('0,0', 6, 4);
    ctx.restore();
  }

  drawRoom(room) {
    const ctx = this.ctx;
    const rect = room.previewRect || room.rect;
    if (!rect) return;

    const isSelected = this.selectedRoomId === room.id;

    ctx.save();
    ctx.fillStyle = room.color || '#79b8ff';
    ctx.globalAlpha = isSelected ? 0.55 : 0.35;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.globalAlpha = 1;
    ctx.lineWidth = isSelected ? 4 : 2;
    ctx.strokeStyle = isSelected ? '#1b4b91' : '#3a6fb0';
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    if (isSelected) {
      const handleSize = ROOM_HANDLE_SIZE;
      const half = handleSize / 2;
      const corners = [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
      ];

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1b4b91';
      ctx.lineWidth = 1;
      corners.forEach((corner) => {
        ctx.beginPath();
        ctx.rect(corner.x - half, corner.y - half, handleSize, handleSize);
        ctx.fill();
        ctx.stroke();
      });
    }

    ctx.restore();
  }

  drawDraftRoom(rect) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }

  drawWall(wall) {
    const ctx = this.ctx;
    const points = this.getRenderedWallPoints(wall);
    if (!Array.isArray(points) || points.length < 2) return;
    const start = points[0];
    const end = points[1];

    ctx.save();
    ctx.strokeStyle = this.selectedWallId === wall.id ? '#d12d2d' : '#444';
    ctx.lineWidth = this.selectedWallId === wall.id ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();

    if (this.selectedWallId === wall.id) {
      const handleSize = ROOM_HANDLE_SIZE;
      const half = handleSize / 2;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d12d2d';
      ctx.lineWidth = 1;
      [start, end].forEach((point) => {
        ctx.beginPath();
        ctx.rect(point.x - half, point.y - half, handleSize, handleSize);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  drawDraftWall(start, end) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#d12d2d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  getRenderedWallPoints(wall) {
    if (!wall) return [];

    if (Array.isArray(wall.previewPoints) && wall.previewPoints.length > 0) {
      return clonePoints(wall.previewPoints);
    }

    const basePoints = Array.isArray(wall.points) ? wall.points : [];
    const room = this.rooms.find((r) => r.id === wall.roomId);
    if (!room || !room.previewRect || !room.rect) {
      return basePoints;
    }

    const deltaX = room.previewRect.x - room.rect.x;
    const deltaY = room.previewRect.y - room.rect.y;
    return basePoints.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY }));
  }
}
