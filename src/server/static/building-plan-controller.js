function cloneVertices(vertices = []) {
  return Array.isArray(vertices) ? vertices.map((point) => ({ ...point })) : [];
}

function rectFromVertices(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const xs = vertices.map((p) => p.x);
  const ys = vertices.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function verticesFromRect(rect) {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

function parseVertices(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return cloneVertices(rawValue);
  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? cloneVertices(parsed) : [];
    } catch (err) {
      return [];
    }
  }
  return [];
}

function parsePoints(rawValue) {
  return parseVertices(rawValue);
}

const ROUND_DECIMALS = 3;

function roundCoordinate(value, decimals = ROUND_DECIMALS) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundPoint(point, decimals = ROUND_DECIMALS) {
  if (!point) return { x: 0, y: 0 };
  return {
    x: roundCoordinate(point.x, decimals),
    y: roundCoordinate(point.y, decimals),
  };
}

function roundVertices(vertices, decimals = ROUND_DECIMALS) {
  return Array.isArray(vertices) ? vertices.map((point) => roundPoint(point, decimals)) : [];
}

function stringifyValue(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return '';
  }
}

function highlightElement(element) {
  if (!element) return;
  element.classList.add('building-plan-focus');
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    element.classList.remove('building-plan-focus');
  }, 1500);
}

export class BuildingPlanController {
  constructor(formRenderer, formStateManager, section, contextPath = [], meta = null) {
    this.formRenderer = formRenderer;
    this.formStateManager = formStateManager;
    this.section = section;
    this.contextPath = Array.isArray(contextPath) ? contextPath : [];
    this.meta = meta;

    this.floorSection = this.getRepeatableByDataName('building_plan_floors', section?.elements || []);
    this.roomSection = this.floorSection
      ? this.getRepeatableByDataName('building_plan_rooms', this.floorSection.elements || [])
      : null;
    this.wallSection = this.roomSection
      ? this.getRepeatableByDataName('room_walls', this.roomSection.elements || [])
      : null;

    this.floorKey = this.floorSection ? this.formRenderer.getPreferredKey(this.floorSection) : null;
    this.roomKey = this.roomSection ? this.formRenderer.getPreferredKey(this.roomSection) : null;
    this.wallKey = this.wallSection ? this.formRenderer.getPreferredKey(this.wallSection) : null;

    this.rooms = new Map();
    this.walls = new Map();
    this.roomColors = new Map();
    this.listeners = new Set();
    this.floorCount = 0;
    this.floors = [];
    this.activeFloorIndex = 0;

    this.handleRepeatableChange = this.handleRepeatableChange.bind(this);
    document.addEventListener('form0:repeatable-change', this.handleRepeatableChange);

    this.syncFromState();
  }

  dispose() {
    document.removeEventListener('form0:repeatable-change', this.handleRepeatableChange);
    this.listeners.clear();
  }

  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      listener(this.getSnapshot());
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  handleRepeatableChange(event) {
    const detail = event?.detail;
    if (!detail) return;

    const relevantKeys = new Set([this.roomKey, this.wallKey, this.floorKey]);
    if (!relevantKeys.has(detail.sectionKey)) {
      return;
    }

    this.syncFromState();

    if (detail.sectionKey === this.floorKey) {
      if (detail.changeType === 'add') {
        if (typeof detail.instanceIndex === 'number') {
          this.activeFloorIndex = detail.instanceIndex;
        } else if (this.floors.length > 0) {
          this.activeFloorIndex = this.floors.length - 1;
        }
      } else if (detail.changeType === 'remove') {
        this.activeFloorIndex = Math.max(
          0,
          Math.min(this.activeFloorIndex, Math.max(0, this.floors.length - 1))
        );
      }
    }

    if (detail.changeType === 'add' && Array.isArray(detail.instancePath)) {
      if (detail.sectionKey === this.roomKey) {
        this.autoPopulateRoom(detail.instancePath);
      } else if (detail.sectionKey === this.wallKey) {
        this.autoPopulateWall(detail.instancePath);
      }
    }

    this.emitUpdate();
  }

  getRepeatableByDataName(dataName, elements = []) {
    return elements.find((el) => el.type === 'RepeatableSection' && el.data_name === dataName) || null;
  }

  createRoom(rectangle) {
    if (!this.roomSection) {
      throw new Error('Building plan blueprint missing rooms definition');
    }

    const activeFloor = this.floors[this.activeFloorIndex];
    if (!activeFloor) {
      return null;
    }

    const floorPath = [...activeFloor.path];

    this.formRenderer.addRepeatableInstance(this.roomSection, floorPath);
    const roomInstances = this.formRenderer.getRepeatableInstances(this.roomSection, floorPath) || [];
    const roomIndex = roomInstances.length - 1;
    const roomInstance = roomInstances[roomIndex];
    const roomPath = [...floorPath, { key: this.roomKey, index: roomIndex }];

    const roomId = roomInstance?.id || `${this.formRenderer.formatContextPath(roomPath)}`;
    const roomVerticesValue = verticesFromRect(rectangle);
    const roundedVertices = roundVertices(roomVerticesValue);
    const roomVerticesString = stringifyValue(roundedVertices);

    if (roomInstance) {
      if (!roomInstance.values) {
        roomInstance.values = {};
      }
      roomInstance.values.room_vertices = roomVerticesString;
    }

    const provisionalRoom = {
      id: roomId,
      path: roomPath,
      floorIndex: this.activeFloorIndex,
      vertices: roundedVertices,
      rect: { ...rectangle },
      color: this.ensureRoomColor(roomId),
    };
    this.rooms.set(roomId, provisionalRoom);
    this.emitUpdate();

    this.ensurePerimeterWalls(provisionalRoom);

    this.queueFieldUpdate(
      'room_vertices',
      roomPath,
      roomVerticesString,
      () => {
        this.syncFromState();
        this.emitUpdate();
      }
    );

    return provisionalRoom;
  }

  updateRoom(roomId, rectangle) {
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) return;

    const roundedVertices = roundVertices(verticesFromRect(rectangle));

    if (this.formStateManager && typeof this.formStateManager.setFieldValueAtContext === 'function') {
      this.formStateManager.setFieldValueAtContext(
        'room_vertices',
        roomInfo.path,
        stringifyValue(roundedVertices),
        { suppressLogging: true, skipStateUpdate: true }
      );
    }

    const oldRect = roomInfo.rect ? { ...roomInfo.rect } : null;
    const deltaX = oldRect ? rectangle.x - oldRect.x : 0;
    const deltaY = oldRect ? rectangle.y - oldRect.y : 0;
    roomInfo.rect = { ...rectangle };
    roomInfo.vertices = roundedVertices;

    const relatedWalls = Array.from(this.walls.values()).filter((wall) => wall.roomId === roomId);
    relatedWalls.forEach((wall) => {
      const updatedPoints = wall.points.map((point) => {
        if (!oldRect || oldRect.width === 0 || oldRect.height === 0) {
          return {
            x: point.x + deltaX,
            y: point.y + deltaY,
          };
        }

        const relativeX = (point.x - oldRect.x) / oldRect.width;
        const relativeY = (point.y - oldRect.y) / oldRect.height;

        return {
          x: rectangle.x + relativeX * rectangle.width,
          y: rectangle.y + relativeY * rectangle.height,
        };
      });
      const roundedPoints = roundVertices(updatedPoints);
      wall.points = cloneVertices(roundedPoints);
      if (this.formStateManager && typeof this.formStateManager.setFieldValueAtContext === 'function') {
        this.formStateManager.setFieldValueAtContext(
          'wall_geometry',
          wall.path,
          stringifyValue(roundedPoints),
          { suppressLogging: true, skipStateUpdate: true }
        );
      }
    });

    if (relatedWalls.length > 0) {
      this.formStateManager.updateFormState();
    } else if (this.formStateManager && typeof this.formStateManager.updateFormState === 'function') {
      this.formStateManager.updateFormState();
    }

    this.syncFromState();
    this.emitUpdate();
  }

  createWall(roomId, points) {
    if (!this.wallSection) {
      throw new Error('Building plan blueprint missing walls definition');
    }

    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) return null;

    this.formRenderer.addRepeatableInstance(this.wallSection, roomInfo.path);
    const wallInstances = this.formRenderer.getRepeatableInstances(this.wallSection, roomInfo.path) || [];
    const wallIndex = wallInstances.length - 1;
    const wallInstance = wallInstances[wallIndex];
    const wallPath = [...roomInfo.path, { key: this.wallKey, index: wallIndex }];

    const wallId = wallInstance?.id || `${this.formRenderer.formatContextPath(wallPath)}`;
    const roundedPoints = roundVertices(points);
    const wallPointsString = stringifyValue(roundedPoints);

    if (wallInstance) {
      if (!wallInstance.values) {
        wallInstance.values = {};
      }
      wallInstance.values.wall_geometry = wallPointsString;
    }

    const provisionalWall = {
      id: wallId,
      roomId: roomId,
      floorIndex: roomInfo.floorIndex ?? this.activeFloorIndex,
      path: wallPath,
      points: cloneVertices(roundedPoints),
    };
    this.walls.set(wallId, provisionalWall);
    this.emitUpdate();

    this.queueFieldUpdate(
      'wall_geometry',
      wallPath,
      wallPointsString,
      () => {
        this.syncFromState();
        this.emitUpdate();
      }
    );

    return provisionalWall;
  }

  createFloor() {
    if (!this.floorSection) return;
    this.formRenderer.addRepeatableInstance(this.floorSection, this.contextPath);
  }

  queueFieldUpdate(fieldName, path, value, afterUpdate = null) {
    if (
      !this.formStateManager ||
      typeof this.formStateManager.setFieldValueAtContext !== 'function' ||
      typeof this.formStateManager.updateFormState !== 'function'
    ) {
      return;
    }

    this.runAfterRender(() => {
      const success = this.formStateManager.setFieldValueAtContext(
        fieldName,
        path,
        value,
        { suppressLogging: true, skipStateUpdate: true }
      );

      if (success) {
        this.formStateManager.updateFormState();
        if (typeof afterUpdate === 'function') {
          afterUpdate();
        }
        return;
      }

      if (typeof this.formStateManager.registerPendingFieldCallback === 'function') {
        const contextKey = this.formRenderer.formatContextPath(path);
        this.formStateManager.registerPendingFieldCallback(contextKey, fieldName, () => {
          this.formStateManager.updateFormState();
          if (typeof afterUpdate === 'function') {
            afterUpdate();
          }
        });
      }
    });
  }

  updateWall(wallId, points) {
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) return;
    const roundedPoints = roundVertices(points);
    wallInfo.points = cloneVertices(roundedPoints);
    if (wallInfo.previewPoints) {
      delete wallInfo.previewPoints;
    }
    this.emitUpdate();

    this.queueFieldUpdate(
      'wall_geometry',
      wallInfo.path,
      stringifyValue(roundedPoints),
      () => {
        this.syncFromState();
        this.emitUpdate();
      }
    );
  }

  focusRoom(roomId) {
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) return;
    const container = this.formRenderer.getRepeatableInstanceContainer(roomInfo.path);
    highlightElement(container);
  }

  focusWall(wallId) {
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) return;
    const container = this.formRenderer.getRepeatableInstanceContainer(wallInfo.path);
    highlightElement(container);
  }

  getSnapshot() {
    const activeRooms = Array.from(this.rooms.values()).filter(
      (room) => room.floorIndex === this.activeFloorIndex
    );
    const activeWalls = Array.from(this.walls.values()).filter(
      (wall) => wall.floorIndex === this.activeFloorIndex
    );

    return {
      floors: this.floors.map((floor) => ({
        id: floor.id,
        index: floor.index,
        label: floor.label,
      })),
      activeFloorIndex: this.activeFloorIndex,
      rooms: activeRooms.map((room) => ({
        id: room.id,
        path: room.path,
        vertices: cloneVertices(room.vertices),
        rect: { ...room.rect },
        color: room.color,
      })),
      walls: activeWalls.map((wall) => ({
        id: wall.id,
        roomId: wall.roomId,
        path: wall.path,
        points: cloneVertices(wall.points),
      })),
    };
  }

  emitUpdate() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[BuildingPlan] listener error', err);
      }
    });
  }

  runAfterRender(callback) {
    if (typeof window === 'undefined') {
      setTimeout(callback, 0);
      return;
    }

    window.requestAnimationFrame(() => {
      setTimeout(callback, 0);
    });
  }

  setActiveFloor(index) {
    if (!this.floors || this.floors.length === 0) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, this.floors.length - 1));
    if (nextIndex === this.activeFloorIndex) {
      return;
    }
    this.activeFloorIndex = nextIndex;
    this.syncFromState();
    this.emitUpdate();
  }

  getActiveFloorPath() {
    const floor = this.floors[this.activeFloorIndex];
    return floor ? [...floor.path] : [];
  }

  ensureRoomColor(roomId) {
    if (!this.roomColors.has(roomId)) {
      const palette = ['#79b8ff', '#b392f0', '#ffab70', '#ff938a', '#f7c843', '#46d1b8'];
      const color = palette[this.roomColors.size % palette.length];
      this.roomColors.set(roomId, color);
    }
    return this.roomColors.get(roomId);
  }

  syncFromState() {
    this.rooms.clear();
    this.walls.clear();
    this.floors = [];

    if (!this.floorSection || !this.roomSection) {
      this.floorCount = 0;
      return;
    }

    const floorInstances = this.formRenderer.getRepeatableInstances(this.floorSection, this.contextPath) || [];
    this.floorCount = floorInstances.length;

    floorInstances.forEach((floorInstance, floorIndex) => {
      const floorPath = [...this.contextPath, { key: this.floorKey, index: floorIndex }];
      const floorId =
        floorInstance && floorInstance.id
          ? floorInstance.id
          : this.formRenderer.formatContextPath(floorPath);
      const label = 'Floor #' + (floorIndex + 1);

      this.floors.push({
        id: floorId,
        index: floorIndex,
        label,
        path: floorPath,
      });

      const roomInstances = this.formRenderer.getRepeatableInstances(this.roomSection, floorPath) || [];

      roomInstances.forEach((roomInstance, roomIndex) => {
        const roomPath = [...floorPath, { key: this.roomKey, index: roomIndex }];
        const vertices = roundVertices(parseVertices(roomInstance?.values?.room_vertices));
        const rect = rectFromVertices(vertices);
        const roomId =
          roomInstance && roomInstance.id
            ? roomInstance.id
            : this.formRenderer.formatContextPath(roomPath);
        const color = this.ensureRoomColor(roomId);

        this.rooms.set(roomId, {
          id: roomId,
          path: roomPath,
          floorIndex,
          vertices,
          rect,
          color,
        });

        if (!this.wallSection) return;

        const wallInstances = this.formRenderer.getRepeatableInstances(this.wallSection, roomPath) || [];

        wallInstances.forEach((wallInstance, wallIndex) => {
          const wallPath = [...roomPath, { key: this.wallKey, index: wallIndex }];
          const points = roundVertices(parsePoints(wallInstance?.values?.wall_geometry));
          const wallId =
            wallInstance && wallInstance.id
              ? wallInstance.id
              : this.formRenderer.formatContextPath(wallPath);

          this.walls.set(wallId, {
            id: wallId,
            roomId: roomId,
            floorIndex,
            path: wallPath,
            points,
          });
        });
      });
    });

    if (this.floors.length === 0) {
      this.activeFloorIndex = 0;
    } else if (this.activeFloorIndex >= this.floors.length) {
      this.activeFloorIndex = this.floors.length - 1;
    }
  }

  hasFloors() {
    return this.floors && this.floors.length > 0;
  }


  autoPopulateRoom(instancePath) {
    const room = this.findRoomByPath(instancePath);
    if (!room) return;
    const vertices = Array.isArray(room.vertices) ? room.vertices : [];
    if (vertices.length >= 4) {
      this.ensurePerimeterWalls(room);
      return;
    }

    const roomIndexSegment = instancePath[instancePath.length - 1] || { index: 0 };
    const offset = (roomIndexSegment.index || 0) * 40;
    const rect = {
      x: 40 + offset,
      y: 40 + (offset % 160),
      width: 120,
      height: 80,
    };
    const verticesValue = roundVertices(verticesFromRect(rect));
    const verticesString = stringifyValue(verticesValue);

    room.rect = { ...rect };
    room.vertices = verticesValue;

    this.queueFieldUpdate(
      'room_vertices',
      instancePath,
      verticesString,
      () => {
        this.ensurePerimeterWalls(room);
      }
    );
  }

  autoPopulateWall(instancePath) {
    const wall = this.findWallByPath(instancePath);
    if (!wall) return;
    const points = Array.isArray(wall.points) ? wall.points : [];
    if (points.length >= 2) {
      return;
    }

    const parentRoomPath = instancePath.slice(0, -1);
    const room = this.findRoomByPath(parentRoomPath);
    if (!room || !room.rect) {
      return;
    }

    const centerY = room.rect.y + room.rect.height / 2;
    const margin = Math.min(20, room.rect.width / 4);
    const start = { x: room.rect.x + margin, y: centerY };
    const end = { x: room.rect.x + room.rect.width - margin, y: centerY };
    const defaultPoints = [start, end];

    wall.points = cloneVertices(defaultPoints);

    this.queueFieldUpdate(
      'wall_geometry',
      instancePath,
      stringifyValue(defaultPoints)
    );
  }

  ensurePerimeterWalls(room) {
    if (!this.wallSection) return;
    const existing = Array.from(this.walls.values()).filter((wall) => wall.roomId === room.id);
    if (existing.length > 0) {
      return;
    }

    const { rect } = room;
    const edges = [
      [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
      ],
      [
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
      ],
      [
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
      ],
      [
        { x: rect.x, y: rect.y + rect.height },
        { x: rect.x, y: rect.y },
      ],
    ];

    edges.forEach((edge) => {
      this.createWall(room.id, edge);
    });
  }

  findRoomByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const room of this.rooms.values()) {
      if (this.formRenderer.formatContextPath(room.path) === key) {
        return room;
      }
    }
    return null;
  }

  findWallByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const wall of this.walls.values()) {
      if (this.formRenderer.formatContextPath(wall.path) === key) {
        return wall;
      }
    }
    return null;
  }

}
