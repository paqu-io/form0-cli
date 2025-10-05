const MODE_SELECT = 'select';
const MODE_DRAW_ROOM = 'draw-room';
const MODE_DRAW_WALL = 'draw-wall';

const DEFAULT_GRID_SIZE = 20;
const SNAP_RADIUS = 10;
const WALL_HIT_TOLERANCE = 6;

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
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

export class BuildingPlanCanvas {
  constructor({ container, controller }) {
    this.container = container;
    this.controller = controller;

    this.mode = MODE_SELECT;
    this.rooms = [];
    this.walls = [];
    this.hasFloors = false;
    this.selectedRoomId = null;
    this.selectedWallId = null;

    this.dragState = null;
    this.wallDraft = null;
    this.roomDraft = null;

    this.gridSize = DEFAULT_GRID_SIZE;

    this.unsubscribe = null;

    this.buildUI();
    this.attachEvents();
    this.subscribeToController();
    this.render();
  }

  destroy() {
    window.removeEventListener('resize', this.boundResizeHandler);
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
    this.roomButton = this.createToolbarButton('Draw Room', MODE_DRAW_ROOM);
    this.wallButton = this.createToolbarButton('Draw Wall', MODE_DRAW_WALL);

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'building-plan-toolbar-button';
    this.clearButton.textContent = 'Clear Selection';
    this.clearButton.addEventListener('click', () => this.clearSelection());

    this.toolbar.appendChild(this.selectButton);
    this.toolbar.appendChild(this.roomButton);
    this.toolbar.appendChild(this.wallButton);
    this.toolbar.appendChild(this.clearButton);

    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'building-plan-canvas-container';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'building-plan-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.canvasContainer.appendChild(this.canvas);

    this.container.appendChild(this.toolbar);
    this.container.appendChild(this.canvasContainer);

    this.boundResizeHandler = () => this.resizeCanvas();
    window.addEventListener('resize', this.boundResizeHandler);
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
      this.rooms = snapshot.rooms || [];
      this.walls = snapshot.walls || [];
      this.hasFloors = this.controller?.hasFloors?.() || false;

      if (this.selectedRoomId && !this.rooms.find((room) => room.id === this.selectedRoomId)) {
        this.selectedRoomId = null;
      }
      if (this.selectedWallId && !this.walls.find((wall) => wall.id === this.selectedWallId)) {
        this.selectedWallId = null;
      }

      this.updateCursor();
      this.updateButtonStates();
      this.render();
    });
  }

  updateCursor() {
    if (!this.canvas) return;
    if (this.mode === MODE_SELECT) {
      this.canvas.style.cursor = this.dragState ? 'grabbing' : 'grab';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
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
    this.updateCursor();
    this.render();
  }

  handleMouseDown(event) {
    const point = this.getCanvasPoint(event);

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

    const room = this.findRoomAtPoint(point);
    const wall = this.findWallNearPoint(point);

    if (room) {
      this.selectedRoomId = room.id;
      this.selectedWallId = null;
      this.dragState = {
        roomId: room.id,
        offsetX: point.x - room.rect.x,
        offsetY: point.y - room.rect.y,
      };
      this.controller?.focusRoom(room.id);
      this.updateButtonStates();
      this.updateCursor();
      this.render();
      return;
    }

    if (wall) {
      this.selectedRoomId = null;
      this.selectedWallId = wall.id;
      this.controller?.focusWall(wall.id);
      this.updateButtonStates();
      this.render();
      return;
    }

    this.clearSelection();
  }

  handleMouseMove(event) {
    const point = this.getCanvasPoint(event);

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
      const room = this.rooms.find((r) => r.id === this.dragState.roomId);
      if (!room) return;

      const width = room.rect.width;
      const height = room.rect.height;
      const snappedOrigin = this.snapPoint({
        x: point.x - this.dragState.offsetX,
        y: point.y - this.dragState.offsetY,
      });
      const newRect = {
        x: snappedOrigin.x,
        y: snappedOrigin.y,
        width,
        height,
      };

      this.previewRoomMovement(room.id, newRect);
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
          const created = this.controller?.createWall(room.id, [this.wallDraft.start, endPoint]);
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
      const room = this.rooms.find((r) => r.id === this.dragState.roomId);
      if (room) {
        const commitRect = room.previewRect || room.rect;
        if (commitRect) {
          this.controller?.updateRoom(room.id, commitRect);
        }
      }
      this.dragState = null;
      this.rooms.forEach((r) => delete r.previewRect);
      this.updateCursor();
      this.updateButtonStates();
      this.render();
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
    }
    this.updateCursor();
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

    return bestPoint;
  }

  snapToRoomEdges(point, room) {
    const rect = room.rect;
    if (!rect) return this.snapPoint(point);

    const clamped = {
      x: clamp(point.x, rect.x, rect.x + rect.width),
      y: clamp(point.y, rect.y, rect.y + rect.height),
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
      const dist = distance(vertex, clamped);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestVertex = vertex;
      }
    });

    if (bestVertex) {
      return { x: bestVertex.x, y: bestVertex.y };
    }

    const distances = [
      { axis: 'left', dist: Math.abs(clamped.x - rect.x) },
      { axis: 'right', dist: Math.abs(clamped.x - (rect.x + rect.width)) },
      { axis: 'top', dist: Math.abs(clamped.y - rect.y) },
      { axis: 'bottom', dist: Math.abs(clamped.y - (rect.y + rect.height)) },
    ];

    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances[0];

    switch (nearest.axis) {
      case 'left':
        return { x: rect.x, y: clamped.y };
      case 'right':
        return { x: rect.x + rect.width, y: clamped.y };
      case 'top':
        return { x: clamped.x, y: rect.y };
      case 'bottom':
      default:
        return { x: clamped.x, y: rect.y + rect.height };
    }
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

  previewRoomMovement(roomId, newRect) {
    this.rooms.forEach((room) => {
      if (room.id === roomId) {
        room.previewRect = newRect;
      } else {
        delete room.previewRect;
      }
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

    this.walls.forEach((wall) => this.drawWall(wall));

    if (this.wallDraft && this.wallDraft.start && this.wallDraft.end) {
      this.drawDraftWall(this.wallDraft.start, this.wallDraft.end);
    }

    this.rooms.forEach((room) => this.drawRoom(room));

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

  updateButtonStates() {
    const hasFloors = this.hasFloors;
    const hasSelectedRoom = Boolean(this.selectedRoomId);

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
  }

  drawRoom(room) {
    const ctx = this.ctx;
    const rect = room.previewRect || room.rect;
    if (!rect) return;

    ctx.save();
    ctx.fillStyle = room.color || '#79b8ff';
    ctx.globalAlpha = this.selectedRoomId === room.id ? 0.5 : 0.35;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    ctx.globalAlpha = 1;
    ctx.lineWidth = this.selectedRoomId === room.id ? 3 : 2;
    ctx.strokeStyle = this.selectedRoomId === room.id ? '#1b4b91' : '#3a6fb0';
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

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
    const points = Array.isArray(wall.points) ? wall.points : [];
    const room = this.rooms.find((r) => r.id === wall.roomId);
    if (!room || !room.previewRect || !room.rect) {
      return points;
    }

    const deltaX = room.previewRect.x - room.rect.x;
    const deltaY = room.previewRect.y - room.rect.y;
    return points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY }));
  }
}
