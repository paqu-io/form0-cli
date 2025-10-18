const MODE_SELECT = 'select';
const MODE_DRAW_ROOM = 'draw-room';
const MODE_DRAW_WALL = 'draw-wall';
const MODE_DRAW_DOOR = 'draw-door';
const MODE_DRAW_WINDOW = 'draw-window';
const MODE_DRAW_COLUMN = 'draw-column';
const MODE_DRAW_BEAM = 'draw-beam';

const DEFAULT_GRID_SIZE = 20;
const SNAP_RADIUS = 10;
const WALL_HIT_TOLERANCE = 6;
const ROOM_HANDLE_SIZE = 6;
const ROOM_HANDLE_HIT_SIZE = 12;
const WALL_HANDLE_HIT_RADIUS = 8;
const OPENING_HIT_TOLERANCE = 12;
const OPENING_HANDLE_RADIUS = 10;
const DOOR_LINE_WIDTH = 6;
const WINDOW_LINE_WIDTH = 6;
const DOOR_COLOR = '#2b8a3e';
const WINDOW_COLOR = '#1c7ed6';
const COLUMN_COLOR = '#f59f00';
const BEAM_COLOR = '#7048e8';
const LABEL_BACKGROUND = '#ffffff';
const LABEL_BORDER = '#2f3640';
const LABEL_TEXT_COLOR = '#2f3640';
const LABEL_FONT = '12px Inter, sans-serif';
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 4;
const OPENING_SELECTED_COLOR = '#d12d2d';
const STRUCTURAL_SELECTED_COLOR = '#d12d2d';
const STRUCTURAL_SNAP_TOLERANCE = 14;
const DEFAULT_DOOR_WIDTH_M = 0.9;
const DEFAULT_DOOR_HEIGHT_M = 2;
const DEFAULT_WINDOW_WIDTH_M = 1.2;
const DEFAULT_WINDOW_HEIGHT_M = 1.2;
const DEFAULT_WINDOW_SILL_HEIGHT_M = 0.9;
const DEFAULT_COLUMN_WIDTH_M = 0.3;
const DEFAULT_COLUMN_HEIGHT_M = 0.3;
const DEFAULT_COLUMN_VERTICAL_HEIGHT_M = 3;
const DEFAULT_BEAM_WIDTH_M = 0.25;
const DEFAULT_BEAM_HEIGHT_M = 0.4;
const MIN_OPENING_RATIO = 0.05;
const ROUND_DECIMALS = 3;
const DEFAULT_LABEL_SETTINGS = {
  rooms: true,
  walls: true,
  doors: true,
  windows: true,
  columns: true,
  beams: true,
};

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

function projectScalarToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
}

function getSegmentPoints(points = [], segmentIndex = 0) {
  if (!Array.isArray(points) || points.length < 2) {
    return null;
  }
  const index = clamp(segmentIndex, 0, points.length - 2);
  const start = points[index];
  const end = points[index + 1];
  if (!start || !end) {
    return null;
  }
  return { start, end };
}

function lengthToMeters(length, gridSize = DEFAULT_GRID_SIZE) {
  if (!Number.isFinite(length) || !Number.isFinite(gridSize) || gridSize === 0) {
    return 0;
  }
  return length / gridSize;
}

function metersToLength(meters, gridSize = DEFAULT_GRID_SIZE) {
  if (!Number.isFinite(meters)) return 0;
  return meters * gridSize;
}

function getRoomRatios(point, rect) {
  if (!rect || rect.width === 0 || rect.height === 0) {
    return { u: 0, v: 0 };
  }
  return {
    u: clamp((point.x - rect.x) / rect.width, 0, 1),
    v: clamp((point.y - rect.y) / rect.height, 0, 1),
  };
}

function clampPointToRoom(point, rect) {
  if (!rect) return { x: point.x, y: point.y };
  return {
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height),
  };
}

function pointInRect(point, rect) {
  if (!rect) return false;
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function inflateRect(rect, amount) {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function formatShortLabel(label, prefix, fallbackNumber = null, longPrefix = null) {
  const upperPrefix = prefix ? String(prefix).toUpperCase() : '';
  const expected = (longPrefix || prefix || '').toLowerCase();
  if (typeof label === 'string' && label.trim() !== '') {
    const trimmed = label.trim();
    const lowerTrimmed = trimmed.toLowerCase();
    const hashMatch = trimmed.match(/#\s*(\d+)/);
    if (hashMatch && upperPrefix) {
      return `${upperPrefix}#${hashMatch[1]}`;
    }
    if (expected && lowerTrimmed.startsWith(expected)) {
      const numberMatch = trimmed.match(/(\d+)/);
      if (numberMatch && upperPrefix) {
        return `${upperPrefix}#${numberMatch[1]}`;
      }
    }
    return trimmed;
  }
  if (fallbackNumber != null && upperPrefix) {
    return `${upperPrefix}#${fallbackNumber}`;
  }
  return label || null;
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
  constructor({ container, controller, labelSettings = {} }) {
    this.container = container;
    this.controller = controller;
    this.labelSettings = { ...DEFAULT_LABEL_SETTINGS, ...labelSettings };

    this.mode = MODE_SELECT;
    this.rooms = [];
    this.walls = [];
    this.doors = [];
    this.windows = [];
    this.columns = [];
    this.beams = [];
    this.floors = [];
    this.activeFloorIndex = 0;
    this.hasFloors = false;
    this.selectedRoomId = null;
    this.selectedWallId = null;
    this.selectedDoorId = null;
    this.selectedWindowId = null;
    this.selectedColumnId = null;
    this.selectedBeamId = null;

    this.dragState = null;
    this.wallDragState = null;
    this.openingDragState = null;
    this.columnDragState = null;
    this.beamDragState = null;
    this.wallDraft = null;
    this.roomDraft = null;
    this.beamDraft = null;
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

  setLabelSettings(settings = {}) {
    const next = { ...DEFAULT_LABEL_SETTINGS, ...settings };
    const changed = Object.keys(DEFAULT_LABEL_SETTINGS).some(
      (key) => this.labelSettings[key] !== next[key]
    );
    this.labelSettings = next;
    if (changed) {
      this.render();
    }
  }

  shouldShowLabel(type) {
    if (!this.labelSettings) return true;
    if (Object.prototype.hasOwnProperty.call(this.labelSettings, type)) {
      return Boolean(this.labelSettings[type]);
    }
    return true;
  }

  buildUI() {
    this.container.innerHTML = '';
    this.container.classList.add('building-plan-canvas-wrapper');

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'building-plan-toolbar';

    this.selectButton = this.createToolbarButton('Select / Move / Resize', MODE_SELECT);
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
    this.columnButton = this.createToolbarButton('Place Column', MODE_DRAW_COLUMN);
    this.beamButton = this.createToolbarButton('Draw Beam', MODE_DRAW_BEAM);
    this.doorButton = this.createToolbarButton('Place Door', MODE_DRAW_DOOR);
    this.windowButton = this.createToolbarButton('Place Window', MODE_DRAW_WINDOW);

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'building-plan-toolbar-button';
    this.clearButton.textContent = 'Clear Selection';
    this.clearButton.addEventListener('click', () => this.clearSelection());

    this.toolbar.appendChild(this.selectButton);
    this.toolbar.appendChild(this.floorButton);
    this.toolbar.appendChild(this.roomButton);
    this.toolbar.appendChild(this.wallButton);
    this.toolbar.appendChild(this.columnButton);
    this.toolbar.appendChild(this.beamButton);
    this.toolbar.appendChild(this.doorButton);
    this.toolbar.appendChild(this.windowButton);
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
    if (mode === MODE_DRAW_COLUMN && this.columnButton && this.columnButton.disabled) {
      return;
    }
    if (mode === MODE_DRAW_BEAM && this.beamButton && this.beamButton.disabled) {
      return;
    }
    if (mode === MODE_DRAW_DOOR && this.doorButton && this.doorButton.disabled) {
      return;
    }
    if (mode === MODE_DRAW_WINDOW && this.windowButton && this.windowButton.disabled) {
      return;
    }
    this.mode = mode;
    this.selectButton.classList.toggle('active', mode === MODE_SELECT);
    this.roomButton.classList.toggle('active', mode === MODE_DRAW_ROOM);
    this.wallButton.classList.toggle('active', mode === MODE_DRAW_WALL);
    if (this.columnButton) {
      this.columnButton.classList.toggle('active', mode === MODE_DRAW_COLUMN);
    }
    if (this.beamButton) {
      this.beamButton.classList.toggle('active', mode === MODE_DRAW_BEAM);
    }
    if (this.doorButton) {
      this.doorButton.classList.toggle('active', mode === MODE_DRAW_DOOR);
    }
    if (this.windowButton) {
      this.windowButton.classList.toggle('active', mode === MODE_DRAW_WINDOW);
    }
    this.wallDraft = null;
    this.roomDraft = null;
    this.beamDraft = null;
    this.dragState = null;
    this.wallDragState = null;
    this.openingDragState = null;
    this.columnDragState = null;
    this.beamDragState = null;
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
      this.columns = snapshot.columns || [];
      this.beams = snapshot.beams || [];
      this.doors = snapshot.doors || [];
      this.windows = snapshot.windows || [];
      this.floors = snapshot.floors || [];
      this.activeFloorIndex =
        typeof snapshot.activeFloorIndex === 'number' ? snapshot.activeFloorIndex : 0;
      this.hasFloors = this.floors.length > 0;

      if (prevActiveFloor !== this.activeFloorIndex || prevFloorCount !== this.floors.length) {
        this.selectedRoomId = null;
        this.selectedWallId = null;
        this.wallDragState = null;
        this.selectedDoorId = null;
        this.selectedWindowId = null;
        this.openingDragState = null;
      } else {
        if (this.selectedRoomId && !this.rooms.find((room) => room.id === this.selectedRoomId)) {
          this.selectedRoomId = null;
        }
        if (this.selectedWallId && !this.walls.find((wall) => wall.id === this.selectedWallId)) {
          this.selectedWallId = null;
        }
        if (this.selectedDoorId && !this.doors.find((door) => door.id === this.selectedDoorId)) {
          this.selectedDoorId = null;
        }
        if (
          this.selectedWindowId &&
          !this.windows.find((window) => window.id === this.selectedWindowId)
        ) {
          this.selectedWindowId = null;
        }
        if (
          this.selectedColumnId &&
          !this.columns.find((column) => column.id === this.selectedColumnId)
        ) {
          this.selectedColumnId = null;
        }
        if (this.selectedBeamId && !this.beams.find((beam) => beam.id === this.selectedBeamId)) {
          this.selectedBeamId = null;
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

    if (this.columnDragState) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (this.beamDragState) {
      if (this.beamDragState.mode && this.beamDragState.mode.startsWith('resize')) {
        this.canvas.style.cursor = 'ew-resize';
      } else {
        this.canvas.style.cursor = 'grabbing';
      }
      return;
    }

    if (this.openingDragState) {
      if (this.openingDragState.handle === 'move') {
        this.canvas.style.cursor = 'grabbing';
      } else {
        this.canvas.style.cursor = 'ew-resize';
      }
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
    if (hover && hover.type === 'opening-handle') {
      this.canvas.style.cursor = hover.handle === 'center' ? 'grab' : 'ew-resize';
      return;
    }
    if (hover && hover.type === 'opening') {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (hover && hover.type === 'column') {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (hover && hover.type === 'beam-handle') {
      this.canvas.style.cursor = 'ew-resize';
      return;
    }
    if (hover && hover.type === 'beam') {
      this.canvas.style.cursor = 'grab';
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
    this.selectedDoorId = null;
    this.selectedWindowId = null;
    this.selectedColumnId = null;
    this.selectedBeamId = null;
    this.wallDragState = null;
    this.openingDragState = null;
    this.columnDragState = null;
    this.beamDragState = null;
    this.beamDraft = null;
    this.hoverState = null;
    this.rooms.forEach((room) => {
      if (room.previewRect) delete room.previewRect;
    });
    this.walls.forEach((wall) => {
      if (wall.previewPoints) delete wall.previewPoints;
    });
    if (Array.isArray(this.doors)) {
      this.doors.forEach((door) => {
        if (door.preview && door.preview.points) {
          delete door.preview;
        }
      });
    }
    if (Array.isArray(this.windows)) {
      this.windows.forEach((window) => {
        if (window.preview && window.preview.points) {
          delete window.preview;
        }
      });
    }
    if (Array.isArray(this.columns)) {
      this.columns.forEach((column) => {
        if (column.preview) {
          delete column.preview;
        }
      });
    }
    if (Array.isArray(this.beams)) {
      this.beams.forEach((beam) => {
        if (beam.preview) {
          delete beam.preview;
        }
      });
    }
    this.updateCursor();
    this.updateButtonStates();
    this.render();
  }

  handleMouseDown(event) {
    const point = this.getCanvasPoint(event);

    if (this.mode === MODE_DRAW_COLUMN) {
      const room = this.findRoomAtPoint(point);
      if (!room) {
        return;
      }
      const roomRect = this.getRoomRect(room.id);
      if (!roomRect) {
        return;
      }
      let placementPoint = clampPointToRoom(point, roomRect);
      let wallSegmentIndex = -1;
      let wallRatio = 0;
      const wallSnap = this.snapPointToWall(placementPoint, room.id);
      if (wallSnap) {
        placementPoint = wallSnap.point;
        wallSegmentIndex = wallSnap.segmentIndex;
        wallRatio = wallSnap.ratio;
      }
      const ratios = getRoomRatios(placementPoint, roomRect);
      const created = this.controller?.createColumn?.(room.id, {
        centerU: ratios.u,
        centerV: ratios.v,
        wallSegmentIndex,
        wallRatio,
        width: DEFAULT_COLUMN_WIDTH_M,
        height: DEFAULT_COLUMN_HEIGHT_M,
        vertical: DEFAULT_COLUMN_VERTICAL_HEIGHT_M,
      });
      if (created) {
        this.selectedColumnId = created.id;
        this.selectedBeamId = null;
        this.selectedWallId = null;
        this.selectedDoorId = null;
        this.selectedWindowId = null;
        if (typeof this.controller?.focusColumn === 'function') {
          this.controller.focusColumn(created.id);
        }
      }
      this.render();
      return;
    }

    if (this.mode === MODE_DRAW_BEAM) {
      const room = this.findRoomAtPoint(point);
      if (!room) {
        return;
      }
      const roomRect = this.getRoomRect(room.id);
      if (!roomRect) {
        return;
      }
      const startPoint = clampPointToRoom(point, roomRect);
      this.beamDraft = {
        roomId: room.id,
        start: startPoint,
        current: startPoint,
      };
      this.updateBeamDraft(startPoint);
      this.render();
      return;
    }

    if (this.mode === MODE_DRAW_DOOR || this.mode === MODE_DRAW_WINDOW) {
      const wallHit = this.findWallNearPoint(point);
      if (wallHit && wallHit.wall) {
        const created = this.placeOpening(
          this.mode === MODE_DRAW_DOOR ? 'door' : 'window',
          wallHit
        );
        if (created && created.wallId && typeof this.controller?.focusWall === 'function') {
          this.controller.focusWall(created.wallId);
        }
        this.updateButtonStates();
        this.updateCursor();
        this.render();
      }
      return;
    }

    if (this.mode === MODE_SELECT) {
      const roomHandleHit = this.findRoomHandle(point);
      if (roomHandleHit && roomHandleHit.room) {
        const { room, handle } = roomHandleHit;
        const rect = room.previewRect || room.rect;
        if (rect) {
          this.selectedRoomId = room.id;
          this.selectedWallId = null;
          this.selectedDoorId = null;
          this.selectedWindowId = null;
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
        this.selectedDoorId = null;
        this.selectedWindowId = null;
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

      const columnHit = this.findColumnHit(point);
      if (columnHit) {
        const { column } = columnHit;
        this.selectedColumnId = column.id;
        this.selectedBeamId = null;
        this.selectedWallId = null;
        this.selectedDoorId = null;
        this.selectedWindowId = null;
        const center = column._renderCenter || { x: point.x, y: point.y };
        this.columnDragState = {
          columnId: column.id,
          pointerStart: point,
          offsetX: center.x - point.x,
          offsetY: center.y - point.y,
          moved: false,
        };
        this.setHoverState(null);
        if (typeof this.controller?.focusColumn === 'function') {
          this.controller.focusColumn(column.id);
        }
        this.updateButtonStates();
        this.updateCursor();
        this.render();
        return;
      }

      const beamHandleHit = this.findBeamHandle(point);
      if (beamHandleHit) {
        const { beam, handle } = beamHandleHit;
        this.selectedBeamId = beam.id;
        this.selectedColumnId = null;
        this.selectedWallId = null;
        this.selectedDoorId = null;
        this.selectedWindowId = null;
        this.beamDragState = {
          beamId: beam.id,
          mode: handle === 'start' ? 'resize-start' : 'resize-end',
          handle,
          pointerStart: point,
          roomId: beam.roomId,
          original: {
            startPoint: beam._renderStart ? { ...beam._renderStart } : null,
            endPoint: beam._renderEnd ? { ...beam._renderEnd } : null,
            startU: beam.startU,
            startV: beam.startV,
            endU: beam.endU,
            endV: beam.endV,
            width: beam.width,
            height: beam.height,
            wallSegmentIndex: beam.wallSegmentIndex,
            startRatio: beam.startRatio,
            endRatio: beam.endRatio,
          },
        };
        this.setHoverState(null);
        if (typeof this.controller?.focusBeam === 'function') {
          this.controller.focusBeam(beam.id);
        }
        this.updateButtonStates();
        this.updateCursor();
        this.render();
        return;
      }

      const beamHit = this.findBeamHit(point);
      if (beamHit) {
        const { beam } = beamHit;
        this.selectedBeamId = beam.id;
        this.selectedColumnId = null;
        this.selectedWallId = null;
        this.selectedDoorId = null;
        this.selectedWindowId = null;
        const roomRect = this.getRoomRect(beam.roomId);
        const startPoint = beam._renderStart;
        const endPoint = beam._renderEnd;
        this.beamDragState = {
          beamId: beam.id,
          mode: 'move',
          pointerStart: point,
          roomId: beam.roomId,
          original: {
            startPoint: startPoint ? { ...startPoint } : null,
            endPoint: endPoint ? { ...endPoint } : null,
            startU: beam.startU,
            startV: beam.startV,
            endU: beam.endU,
            endV: beam.endV,
            width: beam.width,
            height: beam.height,
            wallSegmentIndex: beam.wallSegmentIndex,
            startRatio: beam.startRatio,
            endRatio: beam.endRatio,
          },
          roomRect,
        };
        this.setHoverState(null);
        if (typeof this.controller?.focusBeam === 'function') {
          this.controller.focusBeam(beam.id);
        }
        this.updateButtonStates();
        this.updateCursor();
        this.render();
        return;
      }

      const openingHandleHit = this.findOpeningHandle(point);
      if (openingHandleHit) {
        const { type, openingId, handle, geometry } = openingHandleHit;
        if (type === 'door') {
          this.selectedDoorId = openingId;
          this.selectedWindowId = null;
        } else {
          this.selectedWindowId = openingId;
          this.selectedDoorId = null;
        }
        this.selectedWallId = geometry.wall?.id || null;
        const dragHandle = handle === 'center' ? 'move' : handle;
        this.openingDragState = {
          type,
          handle: dragHandle,
          openingId,
          pointerStart: point,
          originalStart: geometry.startRatio,
          originalEnd: geometry.endRatio,
          originalSegmentIndex: geometry.segmentIndex,
          spanRatio: geometry.spanRatio,
          moved: false,
        };
        this.setHoverState(null);
        const focusFn =
          type === 'door' ? this.controller?.focusDoor : this.controller?.focusWindow;
        if (typeof focusFn === 'function') {
          focusFn.call(this.controller, openingId);
        }
        this.updateButtonStates();
        this.updateCursor();
        this.render();
        return;
      }

      const openingHit = this.findOpeningNearPoint(point);
      if (openingHit) {
        const { type, openingId, geometry } = openingHit;
        const isSelected =
          (type === 'door' && this.selectedDoorId === openingId) ||
          (type === 'window' && this.selectedWindowId === openingId);
        if (isSelected) {
          this.openingDragState = {
            type,
            handle: 'move',
            openingId,
            pointerStart: point,
            originalStart: geometry.startRatio,
            originalEnd: geometry.endRatio,
            originalSegmentIndex: geometry.segmentIndex,
            spanRatio: geometry.spanRatio,
            moved: false,
          };
          this.setHoverState(null);
          this.updateCursor();
          this.render();
          return;
        }
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

    const wallHit = this.findWallNearPoint(point);
    const wall = wallHit ? wallHit.wall : null;
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
      this.selectedDoorId = null;
      this.selectedWindowId = null;
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
      !this.openingDragState &&
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
          const columnHit = this.findColumnHit(point);
          if (columnHit) {
            this.setHoverState({
              type: 'column',
              columnId: columnHit.column.id,
              hit: columnHit.type,
            });
          } else {
            const beamHandle = this.findBeamHandle(point);
            if (beamHandle) {
              this.setHoverState({
                type: 'beam-handle',
                beamId: beamHandle.beam.id,
                handle: beamHandle.handle,
              });
            } else {
              const beamHit = this.findBeamHit(point);
              if (beamHit) {
                this.setHoverState({
                  type: 'beam',
                  beamId: beamHit.beam.id,
                  hit: beamHit.type,
                });
              } else {
                const openingHandle = this.findOpeningHandle(point);
                if (openingHandle) {
                  this.setHoverState({
                    type: 'opening-handle',
                    handle: openingHandle.handle,
                    openingType: openingHandle.type,
                    openingId: openingHandle.openingId,
                  });
                } else {
                  const openingHit = this.findOpeningNearPoint(point);
                  if (openingHit) {
                    this.setHoverState({
                      type: 'opening',
                      openingType: openingHit.type,
                      openingId: openingHit.openingId,
                    });
                  } else {
                    this.setHoverState(null);
                  }
                }
              }
            }
          }
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

    if (this.mode === MODE_DRAW_BEAM && this.beamDraft) {
      this.updateBeamDraft(point);
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

    if (this.mode === MODE_SELECT && this.openingDragState) {
      const state = this.openingDragState;
      const opening = this.getOpeningById(state.type, state.openingId);
      if (!opening) return;
      const wall = this.walls.find((w) => w.id === opening.wallId);
      if (!wall) return;

      const renderedPoints = this.getRenderedWallPoints(wall);
      if (!Array.isArray(renderedPoints) || renderedPoints.length < 2) return;

      if (state.handle === 'move') {
        let segmentIndex = state.originalSegmentIndex;
        let centerRatio;
        const wallHit = this.findWallNearPoint(point);
        if (wallHit && wallHit.wall && wallHit.wall.id === wall.id) {
          segmentIndex = wallHit.segmentIndex;
          centerRatio = clamp(wallHit.ratio, 0, 1);
        } else {
          const segment = getSegmentPoints(renderedPoints, segmentIndex);
          if (!segment) return;
          centerRatio = clamp(projectScalarToSegment(point, segment.start, segment.end), 0, 1);
        }
        const minCenter = state.spanRatio / 2;
        const maxCenter = 1 - state.spanRatio / 2;
        const clampedCenter = clamp(centerRatio, minCenter, maxCenter);
        const startRatio = clamp(clampedCenter - state.spanRatio / 2, 0, 1 - state.spanRatio);
        const endRatio = clamp(startRatio + state.spanRatio, 0, 1);
        state.preview = {
          startRatio,
          endRatio,
          segmentIndex,
        };
        state.moved = true;
      } else {
        const segment = getSegmentPoints(renderedPoints, state.originalSegmentIndex);
        if (!segment) return;
        const ratio = clamp(projectScalarToSegment(point, segment.start, segment.end), 0, 1);
        let startRatio = state.originalStart;
        let endRatio = state.originalEnd;
        if (state.handle === 'start') {
          const maxStart = Math.max(0, endRatio - MIN_OPENING_RATIO);
          startRatio = clamp(ratio, 0, maxStart);
          if (endRatio - startRatio < MIN_OPENING_RATIO) {
            startRatio = Math.max(0, endRatio - MIN_OPENING_RATIO);
          }
        } else {
          endRatio = clamp(ratio, Math.max(startRatio + MIN_OPENING_RATIO, 0), 1);
          if (endRatio - startRatio < MIN_OPENING_RATIO) {
            endRatio = Math.min(1, startRatio + MIN_OPENING_RATIO);
          }
        }
        const spanRatio = clamp(endRatio - startRatio, MIN_OPENING_RATIO, 1);
        state.preview = {
          startRatio,
          endRatio,
          segmentIndex: state.originalSegmentIndex,
        };
        state.spanRatio = spanRatio;
        state.moved =
          state.moved ||
          Math.abs(startRatio - state.originalStart) > 0.0005 ||
          Math.abs(endRatio - state.originalEnd) > 0.0005;
      }

      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.columnDragState) {
      const state = this.columnDragState;
      const column = this.columns.find((c) => c.id === state.columnId);
      if (!column) return;
      const roomRect = this.getRoomRect(column.roomId);
      if (!roomRect) return;

      const center = {
        x: point.x + state.offsetX,
        y: point.y + state.offsetY,
      };
      let clamped = clampPointToRoom(center, roomRect);
      let wallSegmentIndex = -1;
      let wallRatio = 0;
      const wallSnap = this.snapPointToWall(clamped, column.roomId);
      if (wallSnap) {
        clamped = wallSnap.point;
        wallSegmentIndex = wallSnap.segmentIndex;
        wallRatio = wallSnap.ratio;
      }
      const ratios = getRoomRatios(clamped, roomRect);
      column.preview = {
        centerU: ratios.u,
        centerV: ratios.v,
        wallSegmentIndex,
        wallRatio,
      };
      state.moved = true;
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.beamDragState) {
      const state = this.beamDragState;
      const beam = this.beams.find((b) => b.id === state.beamId);
      if (!beam) return;
      const roomRect = this.getRoomRect(state.roomId || beam.roomId);
      if (!roomRect) return;

      let startPoint;
      let endPoint;

      if (state.mode === 'move') {
        const originalStartPoint =
          state.original.startPoint || {
            x: roomRect.x + state.original.startU * roomRect.width,
            y: roomRect.y + state.original.startV * roomRect.height,
          };
        const originalEndPoint =
          state.original.endPoint || {
            x: roomRect.x + state.original.endU * roomRect.width,
            y: roomRect.y + state.original.endV * roomRect.height,
          };
        const deltaX = point.x - state.pointerStart.x;
        const deltaY = point.y - state.pointerStart.y;
        startPoint = {
          x: originalStartPoint.x + deltaX,
          y: originalStartPoint.y + deltaY,
        };
        endPoint = {
          x: originalEndPoint.x + deltaX,
          y: originalEndPoint.y + deltaY,
        };
        startPoint = clampPointToRoom(startPoint, roomRect);
        endPoint = clampPointToRoom(endPoint, roomRect);
      } else if (state.mode === 'resize-start') {
        const originalEndPoint = {
          x: roomRect.x + state.original.endU * roomRect.width,
          y: roomRect.y + state.original.endV * roomRect.height,
        };
        startPoint = clampPointToRoom(point, roomRect);
        endPoint = originalEndPoint;
      } else if (state.mode === 'resize-end') {
        const originalStartPoint = {
          x: roomRect.x + state.original.startU * roomRect.width,
          y: roomRect.y + state.original.startV * roomRect.height,
        };
        startPoint = originalStartPoint;
        endPoint = clampPointToRoom(point, roomRect);
      } else {
        return;
      }

      const preview = this.computeBeamPreview(beam.roomId, startPoint, endPoint);
      if (preview) {
        beam.preview = preview;
        if (!state.moved) {
          const diff = Math.abs(preview.startU - beam.startU) +
            Math.abs(preview.startV - beam.startV) +
            Math.abs(preview.endU - beam.endU) +
            Math.abs(preview.endV - beam.endV);
          if (diff > 0.0005) {
            state.moved = true;
          }
        }
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

    if (this.mode === MODE_DRAW_BEAM && this.beamDraft) {
      const draft = this.beamDraft;
      if (draft.preview) {
        const preview = draft.preview;
        const startPoint = preview.startPoint;
        const endPoint = preview.endPoint;
        const length = startPoint && endPoint ? distance(startPoint, endPoint) : 0;
        if (length > 5) {
          const created = this.controller?.createBeam?.(draft.roomId, {
            startU: preview.startU,
            startV: preview.startV,
            endU: preview.endU,
            endV: preview.endV,
            wallSegmentIndex: preview.wallSegmentIndex,
            startRatio: preview.startRatio,
            endRatio: preview.endRatio,
            width: DEFAULT_BEAM_WIDTH_M,
            height: DEFAULT_BEAM_HEIGHT_M,
          });
          if (created) {
            this.selectedBeamId = created.id;
            this.selectedColumnId = null;
            this.selectedDoorId = null;
            this.selectedWindowId = null;
            this.selectedWallId = null;
            if (typeof this.controller?.focusBeam === 'function') {
              this.controller.focusBeam(created.id);
            }
          }
        }
      }
      this.beamDraft = null;
      this.render();
      this.updateCursor();
      this.updateButtonStates();
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

    if (this.mode === MODE_SELECT && this.openingDragState) {
      const state = this.openingDragState;
      const opening = this.getOpeningById(state.type, state.openingId);
      if (opening && state.preview && state.moved) {
        const geometry = this.getOpeningGeometry(opening, state.preview);
        if (geometry) {
          const widthMeters = roundCoordinate(geometry.computedWidthMeters);
          const updates = {
            segmentIndex: geometry.segmentIndex,
            startRatio: geometry.startRatio,
            endRatio: geometry.endRatio,
            width: widthMeters,
          };
          if (state.type === 'door') {
            updates.height = opening.height;
            this.controller?.updateDoor?.(opening.id, updates);
          } else {
            updates.height = opening.height;
            updates.distanceFromFloor = opening.distanceFromFloor;
            this.controller?.updateWindow?.(opening.id, updates);
          }
        }
      }
      this.openingDragState = null;
      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.columnDragState) {
      const state = this.columnDragState;
      const column = this.columns.find((c) => c.id === state.columnId);
      if (column) {
        const preview = column.preview;
        if (preview && state.moved) {
          this.controller?.updateColumn?.(column.id, {
            centerU: preview.centerU,
            centerV: preview.centerV,
            wallSegmentIndex: preview.wallSegmentIndex,
            wallRatio: preview.wallRatio,
          });
        }
        if (column.preview) {
          delete column.preview;
        }
      }
      this.columnDragState = null;
      this.updateCursor();
      this.updateButtonStates();
      this.render();
      return;
    }

    if (this.mode === MODE_SELECT && this.beamDragState) {
      const state = this.beamDragState;
      const beam = this.beams.find((b) => b.id === state.beamId);
      if (beam) {
        const preview = beam.preview;
        if (preview && state.moved) {
          this.controller?.updateBeam?.(beam.id, {
            startU: preview.startU,
            startV: preview.startV,
            endU: preview.endU,
            endV: preview.endV,
            wallSegmentIndex: preview.wallSegmentIndex,
            startRatio: preview.startRatio,
            endRatio: preview.endRatio,
          });
        }
        if (beam.preview) {
          delete beam.preview;
        }
      }
      this.beamDragState = null;
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
    if (this.mode === MODE_DRAW_BEAM) {
      this.beamDraft = null;
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
      if (this.columnDragState) {
        const column = this.columns.find((c) => c.id === this.columnDragState.columnId);
        if (column && column.preview) {
          delete column.preview;
        }
        this.columnDragState = null;
      }
      if (this.beamDragState) {
        const beam = this.beams.find((b) => b.id === this.beamDragState.beamId);
        if (beam && beam.preview) {
          delete beam.preview;
        }
        this.beamDragState = null;
      }
      this.openingDragState = null;
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
      if (room._labelRect && pointInRect(point, room._labelRect)) {
        return room;
      }
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

  getRoomById(roomId) {
    return this.rooms.find((room) => room.id === roomId) || null;
  }

  getRoomRect(roomId) {
    const room = this.getRoomById(roomId);
    if (!room) return null;
    return room.previewRect || room.rect || null;
  }

  computeBeamPreview(roomId, startPoint, endPoint) {
    const roomRect = this.getRoomRect(roomId);
    if (!roomRect) return null;

    let start = clampPointToRoom(startPoint, roomRect);
    let end = clampPointToRoom(endPoint, roomRect);

    const startSnap = this.snapPointToWall(start, roomId);
    if (startSnap) {
      start = startSnap.point;
    }
    const endSnap = this.snapPointToWall(end, roomId);
    if (endSnap) {
      end = endSnap.point;
    }

    const startRatios = getRoomRatios(start, roomRect);
    const endRatios = getRoomRatios(end, roomRect);

    let wallSegmentIndex = -1;
    let startRatio = 0;
    let endRatio = 1;

    if (
      startSnap &&
      endSnap &&
      startSnap.wallId === endSnap.wallId &&
      startSnap.segmentIndex === endSnap.segmentIndex
    ) {
      wallSegmentIndex = startSnap.segmentIndex;
      startRatio = startSnap.ratio;
      endRatio = endSnap.ratio;
    }

    return {
      startU: startRatios.u,
      startV: startRatios.v,
      endU: endRatios.u,
      endV: endRatios.v,
      wallSegmentIndex,
      startRatio,
      endRatio,
      startPoint: start,
      endPoint: end,
    };
  }

  updateBeamDraft(point) {
    if (!this.beamDraft) return;
    const roomRect = this.getRoomRect(this.beamDraft.roomId);
    if (!roomRect) return;
    const current = clampPointToRoom(point, roomRect);
    const preview = this.computeBeamPreview(this.beamDraft.roomId, this.beamDraft.start, current);
    this.beamDraft.current = current;
    this.beamDraft.preview = preview;
  }

  findColumnHit(point) {
    const tolerance = OPENING_HIT_TOLERANCE;
    for (let i = this.columns.length - 1; i >= 0; i -= 1) {
      const column = this.columns[i];
      if (!column) continue;
      const rect = column._renderRect ? inflateRect(column._renderRect, tolerance / 2) : null;
      const labelRect = column._labelRect;
      if (labelRect && pointInRect(point, labelRect)) {
        return { type: 'label', column };
      }
      if (rect && pointInRect(point, rect)) {
        return { type: 'body', column };
      }
    }
    return null;
  }

  findBeamHandle(point) {
    const tolerance = OPENING_HANDLE_RADIUS + 2;
    if (!Array.isArray(this.beams)) return null;
    for (let i = 0; i < this.beams.length; i += 1) {
      const beam = this.beams[i];
      if (!beam) continue;
      const start = beam._renderStart;
      const end = beam._renderEnd;
      if (start && distance(point, start) <= tolerance) {
        return { beam, handle: 'start' };
      }
      if (end && distance(point, end) <= tolerance) {
        return { beam, handle: 'end' };
      }
    }
    return null;
  }

  findBeamHit(point) {
    const tolerance = OPENING_HIT_TOLERANCE;
    if (!Array.isArray(this.beams)) return null;
    for (let i = this.beams.length - 1; i >= 0; i -= 1) {
      const beam = this.beams[i];
      if (!beam) continue;
      const start = beam._renderStart;
      const end = beam._renderEnd;
      if (start && end) {
        const dist = pointToSegmentDistance(point, start, end);
        if (dist <= tolerance) {
          return { type: 'segment', beam };
        }
      }
      const labelRect = beam._labelRect;
      if (labelRect && pointInRect(point, labelRect)) {
        return { type: 'label', beam };
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

  findWallNearPoint(point, roomId = null) {
    let bestMatch = null;
    let bestDistance = WALL_HIT_TOLERANCE;

    this.walls.forEach((wall) => {
      if (roomId && wall.roomId !== roomId) {
        return;
      }
      const renderedPoints = this.getRenderedWallPoints(wall);
      if (!Array.isArray(renderedPoints) || renderedPoints.length < 2) {
        return;
      }

      if (wall._labelRect && pointInRect(point, wall._labelRect)) {
        const start = renderedPoints[0];
        const end = renderedPoints[renderedPoints.length - 1] || start;
        bestDistance = 0;
        bestMatch = {
          wall,
          segmentIndex: 0,
          distance: 0,
          ratio: 0.5,
          closestPoint: start && end
            ? {
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2,
              }
            : { x: point.x, y: point.y },
        };
        return;
      }

      for (let index = 0; index < renderedPoints.length - 1; index += 1) {
        const start = renderedPoints[index];
        const end = renderedPoints[index + 1];
        const distanceToSegment = pointToSegmentDistance(point, start, end);
        if (distanceToSegment < bestDistance) {
          const ratio = clamp(projectScalarToSegment(point, start, end), 0, 1);
          bestDistance = distanceToSegment;
          bestMatch = {
            wall,
            segmentIndex: index,
            distance: distanceToSegment,
            ratio,
            closestPoint: {
              x: start.x + (end.x - start.x) * ratio,
              y: start.y + (end.y - start.y) * ratio,
            },
          };
        }
      }
    });

    return bestMatch;
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
      prev.roomId === nextState.roomId &&
      prev.openingId === nextState.openingId &&
      prev.openingType === nextState.openingType &&
      prev.columnId === nextState.columnId &&
      prev.beamId === nextState.beamId;
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

    this.beams.forEach((beam) => this.drawBeam(beam));
    this.columns.forEach((column) => this.drawColumn(column));

    this.doors.forEach((door) => this.drawOpening(door, 'door'));
    this.windows.forEach((window) => this.drawOpening(window, 'window'));

    if (this.wallDraft && this.wallDraft.start && this.wallDraft.end) {
      this.drawDraftWall(this.wallDraft.start, this.wallDraft.end);
    }

    if (this.beamDraft && this.beamDraft.preview) {
      this.drawDraftBeam(this.beamDraft);
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

  computeLabelRect(text, anchor, { position = 'top', paddingX = LABEL_PADDING_X, paddingY = LABEL_PADDING_Y } = {}) {
    if (!this.ctx || !text) return null;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = LABEL_FONT;
    const metrics = ctx.measureText(text);
    const textHeight = (metrics.actualBoundingBoxAscent || 8) + (metrics.actualBoundingBoxDescent || 4);
    const width = metrics.width + paddingX * 2;
    const height = textHeight + paddingY * 2;
    let x = anchor.x - width / 2;
    let y = anchor.y - height;
    if (position === 'bottom') {
      y = anchor.y;
    } else if (position === 'center') {
      y = anchor.y - height / 2;
    }
    ctx.restore();
    return { x, y, width, height };
  }

  drawLabelBadge(text, anchor, options = {}) {
    if (!this.ctx || !text) return null;
    const ctx = this.ctx;
    const rect = this.computeLabelRect(text, anchor, options);
    if (!rect) return null;
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.fillStyle = LABEL_BACKGROUND;
    ctx.strokeStyle = LABEL_BORDER;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = LABEL_TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
    return rect;
  }

  getColumnRenderInfo(column) {
    const roomRect = this.getRoomRect(column.roomId);
    if (!roomRect || roomRect.width === 0 || roomRect.height === 0) {
      return null;
    }
    const preview = column.preview || null;
    const centerU = preview ? preview.centerU : column.centerU;
    const centerV = preview ? preview.centerV : column.centerV;
    const widthMeters = preview && preview.width != null ? preview.width : column.width;
    const heightMeters = preview && preview.height != null ? preview.height : column.height;
    const wallSegmentIndex = preview && preview.wallSegmentIndex != null ? preview.wallSegmentIndex : column.wallSegmentIndex;
    const wallRatio = preview && preview.wallRatio != null ? preview.wallRatio : column.wallRatio;

    const center = {
      x: roomRect.x + centerU * roomRect.width,
      y: roomRect.y + centerV * roomRect.height,
    };
    const widthPx = Math.max(10, metersToLength(widthMeters || DEFAULT_COLUMN_WIDTH_M, this.gridSize));
    const heightPx = Math.max(10, metersToLength(heightMeters || DEFAULT_COLUMN_HEIGHT_M, this.gridSize));
    const rect = {
      x: center.x - widthPx / 2,
      y: center.y - heightPx / 2,
      width: widthPx,
      height: heightPx,
    };
    const baseLabel = column.displayLabel || column.label;
    const label = formatShortLabel(
      baseLabel,
      'C',
      typeof column.index === 'number' ? column.index + 1 : null,
      'column'
    );
    const labelAnchor = { x: center.x, y: rect.y - 6 };

    column._renderRect = rect;
    column._renderCenter = center;
    column._wallAttachment = { segmentIndex: wallSegmentIndex, ratio: wallRatio };

    return { center, rect, label, labelAnchor, widthPx, heightPx };
  }

  drawColumn(column) {
    column._renderRect = null;
    column._labelRect = null;
    const info = this.getColumnRenderInfo(column);
    if (!info) return;
    const ctx = this.ctx;
    const isSelected = this.selectedColumnId === column.id;
    ctx.save();
    ctx.fillStyle = COLUMN_COLOR;
    ctx.beginPath();
    ctx.rect(info.rect.x, info.rect.y, info.rect.width, info.rect.height);
    ctx.fill();
    if (isSelected) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = STRUCTURAL_SELECTED_COLOR;
      ctx.stroke();
    }
    ctx.restore();

    if (this.shouldShowLabel('columns') && info.label) {
      const labelRect = this.drawLabelBadge(info.label, info.labelAnchor, { position: 'top' });
      if (labelRect) {
        column._labelRect = labelRect;
      }
    } else {
      column._labelRect = null;
    }
  }

  getBeamRenderInfo(beam) {
    const roomRect = this.getRoomRect(beam.roomId);
    if (!roomRect || roomRect.width === 0 || roomRect.height === 0) {
      return null;
    }
    const preview = beam.preview || null;
    const startU = preview ? preview.startU : beam.startU;
    const startV = preview ? preview.startV : beam.startV;
    const endU = preview ? preview.endU : beam.endU;
    const endV = preview ? preview.endV : beam.endV;
    const widthMeters = preview && preview.width != null ? preview.width : beam.width;
    const heightMeters = preview && preview.height != null ? preview.height : beam.height;

    const startPoint = {
      x: roomRect.x + startU * roomRect.width,
      y: roomRect.y + startV * roomRect.height,
    };
    const endPoint = {
      x: roomRect.x + endU * roomRect.width,
      y: roomRect.y + endV * roomRect.height,
    };
    const centerPoint = {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2,
    };
    const lineWidth = Math.max(4, metersToLength(heightMeters || DEFAULT_BEAM_HEIGHT_M, this.gridSize));
    const baseLabel = beam.displayLabel || beam.label;
    const label = formatShortLabel(
      baseLabel,
      'B',
      typeof beam.index === 'number' ? beam.index + 1 : null,
      'beam'
    );
    const labelAnchor = { x: centerPoint.x, y: centerPoint.y - lineWidth - 6 };
    beam._renderStart = startPoint;
    beam._renderEnd = endPoint;

    return { startPoint, endPoint, centerPoint, lineWidth, label, labelAnchor };
  }

  drawBeam(beam) {
    beam._labelRect = null;
    const info = this.getBeamRenderInfo(beam);
    if (!info) return;
    const ctx = this.ctx;
    const isSelected = this.selectedBeamId === beam.id;
    ctx.save();
    ctx.strokeStyle = isSelected ? STRUCTURAL_SELECTED_COLOR : BEAM_COLOR;
    ctx.lineWidth = info.lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(info.startPoint.x, info.startPoint.y);
    ctx.lineTo(info.endPoint.x, info.endPoint.y);
    ctx.stroke();

    if (isSelected) {
      ctx.fillStyle = STRUCTURAL_SELECTED_COLOR;
      ctx.beginPath();
      ctx.arc(info.startPoint.x, info.startPoint.y, OPENING_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(info.endPoint.x, info.endPoint.y, OPENING_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.shouldShowLabel('beams') && info.label) {
      const labelRect = this.drawLabelBadge(info.label, info.labelAnchor, { position: 'top' });
      if (labelRect) {
        beam._labelRect = labelRect;
      }
    } else {
      beam._labelRect = null;
    }
  }

  drawDraftBeam(draft) {
    if (!draft || !draft.preview) return;
    const preview = draft.preview;
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = BEAM_COLOR;
    ctx.lineWidth = Math.max(4, metersToLength(DEFAULT_BEAM_HEIGHT_M, this.gridSize));
    ctx.beginPath();
    ctx.moveTo(preview.startPoint.x, preview.startPoint.y);
    ctx.lineTo(preview.endPoint.x, preview.endPoint.y);
    ctx.stroke();
    ctx.restore();
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
    const hasWalls = Array.isArray(this.walls) && this.walls.length > 0;

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

    if (this.columnButton) {
      this.columnButton.disabled = !hasFloors || !hasSelectedRoom;
      if (!hasFloors) {
        this.columnButton.title = 'Add a floor to enable column placement';
      } else if (!hasSelectedRoom) {
        this.columnButton.title = 'Select a room to place columns';
      } else {
        this.columnButton.title = 'Click inside a room to place a column';
      }
    }

    if (this.beamButton) {
      this.beamButton.disabled = !hasFloors || !hasSelectedRoom;
      if (!hasFloors) {
        this.beamButton.title = 'Add a floor to enable beam drawing';
      } else if (!hasSelectedRoom) {
        this.beamButton.title = 'Select a room to draw beams';
      } else {
        this.beamButton.title = 'Click and drag inside a room to draw a beam';
      }
    }

    if (this.doorButton) {
      this.doorButton.disabled = !hasFloors || !hasWalls;
      if (!hasFloors) {
        this.doorButton.title = 'Add a floor to enable door placement';
      } else if (!hasWalls) {
        this.doorButton.title = 'Draw or select a wall to place doors';
      } else {
        this.doorButton.title = 'Click a wall to place a door';
      }
    }

    if (this.windowButton) {
      this.windowButton.disabled = !hasFloors || !hasWalls;
      if (!hasFloors) {
        this.windowButton.title = 'Add a floor to enable window placement';
      } else if (!hasWalls) {
        this.windowButton.title = 'Draw or select a wall to place windows';
      } else {
        this.windowButton.title = 'Click a wall to place a window';
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

    room._labelRect = null;

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

    if (this.shouldShowLabel('rooms')) {
      const rawLabel =
        room.displayLabel ||
        (typeof room.index === 'number' ? `R#${room.index + 1}` : null);
      const labelText = formatShortLabel(
        rawLabel,
        'R',
        typeof room.index === 'number' ? room.index + 1 : null,
        'room'
      );
      if (labelText) {
        const labelAnchor = { x: rect.x + rect.width / 2, y: rect.y - 6 };
        const labelRect = this.drawLabelBadge(labelText, labelAnchor, { position: 'top' });
        if (labelRect) {
          room._labelRect = labelRect;
        }
      }
    } else {
      room._labelRect = null;
    }
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
    const end = points[points.length - 1] || points[0];

    wall._renderStart = start ? { ...start } : null;
    wall._renderEnd = end ? { ...end } : null;
    wall._labelRect = null;

    ctx.save();
    ctx.strokeStyle = this.selectedWallId === wall.id ? '#d12d2d' : '#444';
    ctx.lineWidth = this.selectedWallId === wall.id ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
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

    if (this.shouldShowLabel('walls')) {
      const rawLabel =
        wall.displayLabel ||
        wall.label ||
        (typeof wall.index === 'number' ? `W#${wall.index + 1}` : null);
      const labelText = formatShortLabel(
        rawLabel,
        'W',
        typeof wall.index === 'number' ? wall.index + 1 : null,
        'wall'
      );
      if (labelText && start && end) {
        const anchor = {
          x: (start.x + end.x) / 2,
          y: (start.y + end.y) / 2,
        };
        const offset = ctx.lineWidth / 2 + 6;
        const labelRect = this.drawLabelBadge(
          labelText,
          { x: anchor.x, y: anchor.y - offset },
          { position: 'top' }
        );
        if (labelRect) {
          wall._labelRect = labelRect;
        }
      }
    } else {
      wall._labelRect = null;
    }
  }

  getOpeningCollection(type) {
    if (type === 'door') return Array.isArray(this.doors) ? this.doors : [];
    if (type === 'window') return Array.isArray(this.windows) ? this.windows : [];
    return [];
  }

  getOpeningById(type, id) {
    if (!id) return null;
    const collection = this.getOpeningCollection(type);
    return collection.find((entry) => entry && entry.id === id) || null;
  }

  getOpeningGeometry(opening, overrides = {}) {
    if (!opening) return null;
    const wall = this.walls.find((entry) => entry.id === opening.wallId);
    if (!wall) return null;

    const wallPoints = this.getRenderedWallPoints(wall);
    if (!Array.isArray(wallPoints) || wallPoints.length < 2) {
      return null;
    }

    const segmentIndexRaw =
      overrides.segmentIndex !== undefined ? overrides.segmentIndex : opening.segmentIndex || 0;
    const segment = getSegmentPoints(wallPoints, segmentIndexRaw);
    if (!segment) {
      return null;
    }

    const startRatioRaw =
      overrides.startRatio !== undefined ? overrides.startRatio : opening.startRatio || 0;
    const endRatioRaw =
      overrides.endRatio !== undefined ? overrides.endRatio : opening.endRatio || 0;

    const startRatio = clamp(startRatioRaw, 0, 1);
    const endRatio = clamp(Math.max(endRatioRaw, startRatio), 0, 1);
    const spanRatio = clamp(endRatio - startRatio, 0, 1);

    const segmentLength = distance(segment.start, segment.end);
    const widthPixels = segmentLength * spanRatio;
    const computedWidthMeters = lengthToMeters(widthPixels, this.gridSize);
    const widthMeters = Number.isFinite(opening.width)
      ? opening.width
      : computedWidthMeters;

    const startPoint = {
      x: segment.start.x + (segment.end.x - segment.start.x) * startRatio,
      y: segment.start.y + (segment.end.y - segment.start.y) * startRatio,
    };
    const endPoint = {
      x: segment.start.x + (segment.end.x - segment.start.x) * endRatio,
      y: segment.start.y + (segment.end.y - segment.start.y) * endRatio,
    };
    const centerPoint = {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2,
    };

    const unit = segmentLength === 0
      ? { x: 0, y: 0 }
      : {
          x: (segment.end.x - segment.start.x) / segmentLength,
          y: (segment.end.y - segment.start.y) / segmentLength,
        };
    const perpendicular = { x: -unit.y, y: unit.x };

    return {
      opening,
      wall,
      segmentIndex: clamp(segmentIndexRaw, 0, wallPoints.length - 2),
      startRatio,
      endRatio,
      spanRatio,
      segmentLength,
      widthPixels,
      widthMeters,
      computedWidthMeters,
      startPoint,
      endPoint,
      centerPoint,
      unit,
      perpendicular,
    };
  }

  drawOpening(opening, type) {
    opening._labelRect = null;
    let overrides;
    if (
      this.openingDragState &&
      this.openingDragState.type === type &&
      this.openingDragState.openingId === opening.id &&
      this.openingDragState.preview
    ) {
      overrides = this.openingDragState.preview;
    }
    const geometry = this.getOpeningGeometry(opening, overrides);
    if (!geometry) return;

    const ctx = this.ctx;
    const isDoor = type === 'door';
    const isSelected = isDoor
      ? this.selectedDoorId === opening.id
      : this.selectedWindowId === opening.id;
    const strokeColor = isSelected ? OPENING_SELECTED_COLOR : isDoor ? DOOR_COLOR : WINDOW_COLOR;
    const lineWidth = isDoor ? DOOR_LINE_WIDTH : WINDOW_LINE_WIDTH;

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
   ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(geometry.startPoint.x, geometry.startPoint.y);
    ctx.lineTo(geometry.endPoint.x, geometry.endPoint.y);
    ctx.stroke();
    ctx.restore();

    const labelType = isDoor ? 'doors' : 'windows';
    if (this.shouldShowLabel(labelType)) {
      const labelText = formatShortLabel(
        opening.label,
        isDoor ? 'D' : 'W',
        null,
        isDoor ? 'door' : 'window'
      );
      if (labelText) {
        const labelOffset = lineWidth / 2 + 6;
        const labelAnchor = {
          x: geometry.centerPoint.x,
          y: geometry.centerPoint.y - labelOffset,
        };
        const labelRect = this.drawLabelBadge(labelText, labelAnchor, { position: 'top' });
        if (labelRect) {
          opening._labelRect = labelRect;
        }
      }
    } else {
      opening._labelRect = null;
    }

    if (isSelected) {
      this.drawOpeningHandles(geometry);
    }
  }

  drawOpeningHandles(geometry) {
    const ctx = this.ctx;
    const handles = [geometry.startPoint, geometry.endPoint];
    ctx.save();
    ctx.fillStyle = OPENING_SELECTED_COLOR;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    handles.forEach((handlePoint) => {
      ctx.beginPath();
      ctx.arc(handlePoint.x, handlePoint.y, OPENING_HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    const center = geometry.centerPoint;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = OPENING_SELECTED_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, OPENING_HANDLE_RADIUS - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  snapPointToWall(point, roomId = null) {
    const hit = this.findWallNearPoint(point, roomId);
    if (!hit || hit.distance > STRUCTURAL_SNAP_TOLERANCE) {
      return null;
    }
    return {
      point: hit.closestPoint,
      wall: hit.wall,
      wallId: hit.wall.id,
      segmentIndex: hit.segmentIndex,
      ratio: hit.ratio,
      distance: hit.distance,
    };
  }

  findOpeningHandle(point) {
    const priority = [];
    if (this.selectedDoorId) {
      const door = this.getOpeningById('door', this.selectedDoorId);
      if (door) priority.push({ type: 'door', opening: door });
    }
    if (this.selectedWindowId) {
      const window = this.getOpeningById('window', this.selectedWindowId);
      if (window) priority.push({ type: 'window', opening: window });
    }
    this.doors.forEach((door) => {
      if (!priority.find((entry) => entry.opening.id === door.id)) {
        priority.push({ type: 'door', opening: door });
      }
    });
    this.windows.forEach((window) => {
      if (!priority.find((entry) => entry.opening.id === window.id)) {
        priority.push({ type: 'window', opening: window });
      }
    });

    for (let i = 0; i < priority.length; i += 1) {
      const { type, opening } = priority[i];
      const geometry = this.getOpeningGeometry(opening);
      if (!geometry) continue;
      const startDist = distance(point, geometry.startPoint);
      if (startDist <= OPENING_HANDLE_RADIUS) {
        return { type, openingId: opening.id, handle: 'start', geometry };
      }
      const endDist = distance(point, geometry.endPoint);
      if (endDist <= OPENING_HANDLE_RADIUS) {
        return { type, openingId: opening.id, handle: 'end', geometry };
      }
      const centerDist = distance(point, geometry.centerPoint);
      if (centerDist <= OPENING_HANDLE_RADIUS) {
        return { type, openingId: opening.id, handle: 'center', geometry };
      }
    }

    return null;
  }

  findOpeningNearPoint(point) {
    const candidates = [];
    if (this.selectedDoorId) {
      const door = this.getOpeningById('door', this.selectedDoorId);
      if (door) candidates.push({ type: 'door', opening: door });
    }
    if (this.selectedWindowId) {
      const window = this.getOpeningById('window', this.selectedWindowId);
      if (window) candidates.push({ type: 'window', opening: window });
    }
    this.doors.forEach((door) => {
      if (!candidates.find((entry) => entry.opening.id === door.id)) {
        candidates.push({ type: 'door', opening: door });
      }
    });
    this.windows.forEach((window) => {
      if (!candidates.find((entry) => entry.opening.id === window.id)) {
        candidates.push({ type: 'window', opening: window });
      }
    });

    let bestMatch = null;
    let bestDistance = OPENING_HIT_TOLERANCE;

    candidates.forEach(({ type, opening }) => {
      const geometry = this.getOpeningGeometry(opening);
      if (!geometry || geometry.segmentLength === 0) return;
      if (opening._labelRect && pointInRect(point, opening._labelRect)) {
        bestDistance = 0;
        bestMatch = { type, openingId: opening.id, geometry };
        return;
      }
      const dist = pointToSegmentDistance(point, geometry.startPoint, geometry.endPoint);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = { type, openingId: opening.id, geometry };
      }
    });

    return bestMatch;
  }

  placeOpening(type, wallHit) {
    const wall = wallHit?.wall;
    if (!wall) return null;

    const renderedPoints = this.getRenderedWallPoints(wall);
    const segment = getSegmentPoints(renderedPoints, wallHit.segmentIndex || 0);
    if (!segment) return null;

    const segmentLength = distance(segment.start, segment.end);
    if (segmentLength === 0) return null;

    const defaultWidthMeters = type === 'door' ? DEFAULT_DOOR_WIDTH_M : DEFAULT_WINDOW_WIDTH_M;
    const defaultHeightMeters = type === 'door' ? DEFAULT_DOOR_HEIGHT_M : DEFAULT_WINDOW_HEIGHT_M;
    const defaultDistanceFromFloor =
      type === 'window' ? DEFAULT_WINDOW_SILL_HEIGHT_M : undefined;

    const desiredSpanPixels = metersToLength(defaultWidthMeters, this.gridSize);
    let spanRatio = desiredSpanPixels / segmentLength;
    if (!Number.isFinite(spanRatio) || spanRatio <= 0) {
      spanRatio = MIN_OPENING_RATIO;
    }
    spanRatio = clamp(spanRatio, MIN_OPENING_RATIO, 0.9);
    const appliedWidthMeters = lengthToMeters(segmentLength * spanRatio, this.gridSize);

    const rawCenter = wallHit.ratio || 0.5;
    const minCenter = spanRatio / 2;
    const maxCenter = 1 - spanRatio / 2;
    const centerRatio = clamp(rawCenter, minCenter, maxCenter);
    const startRatio = clamp(centerRatio - spanRatio / 2, 0, 1 - spanRatio);
    const endRatio = clamp(startRatio + spanRatio, 0, 1);

    if (type === 'door' && this.controller && typeof this.controller.createDoor === 'function') {
      const result = this.controller.createDoor(wall.id, {
        segmentIndex: wallHit.segmentIndex || 0,
        startRatio,
        endRatio,
        width: appliedWidthMeters,
        height: defaultHeightMeters,
      });
      if (result) {
        this.selectedDoorId = result.id;
        this.selectedWindowId = null;
        this.selectedWallId = wall.id;
        if (typeof this.controller.focusDoor === 'function') {
          this.controller.focusDoor(result.id);
        }
      }
      return result;
    }

    if (type === 'window' && this.controller && typeof this.controller.createWindow === 'function') {
      const result = this.controller.createWindow(wall.id, {
        segmentIndex: wallHit.segmentIndex || 0,
        startRatio,
        endRatio,
        width: appliedWidthMeters,
        height: defaultHeightMeters,
        distanceFromFloor: defaultDistanceFromFloor,
      });
      if (result) {
        this.selectedWindowId = result.id;
        this.selectedDoorId = null;
        this.selectedWallId = wall.id;
        if (typeof this.controller.focusWindow === 'function') {
          this.controller.focusWindow(result.id);
        }
      }
      return result;
    }

    return null;
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
