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

function getNodeMeta(meta, nodeKey) {
  if (!meta) {
    return null;
  }
  if (meta.repeatablesByNodeKey && meta.repeatablesByNodeKey[nodeKey]) {
    return meta.repeatablesByNodeKey[nodeKey];
  }
  if (Array.isArray(meta.repeatables)) {
    return meta.repeatables.find((entry) => entry && entry.nodeKey === nodeKey) || null;
  }
  return null;
}

function getRepeatableDataName(meta, nodeKey, fallback) {
  const nodeMeta = getNodeMeta(meta, nodeKey);
  return (nodeMeta && nodeMeta.dataName) || fallback;
}

function getRepeatablePreferredKey(meta, nodeKey, fallback = null) {
  const nodeMeta = getNodeMeta(meta, nodeKey);
  if (nodeMeta && typeof nodeMeta.preferredKey === 'string' && nodeMeta.preferredKey !== '') {
    return nodeMeta.preferredKey;
  }
  return fallback;
}

function getFieldDataName(meta, nodeKey, originalDataName) {
  const nodeMeta = getNodeMeta(meta, nodeKey);
  if (!nodeMeta) {
    return originalDataName;
  }
  if (
    nodeMeta.fieldsByOriginalDataName &&
    nodeMeta.fieldsByOriginalDataName[originalDataName] &&
    nodeMeta.fieldsByOriginalDataName[originalDataName].dataName
  ) {
    return nodeMeta.fieldsByOriginalDataName[originalDataName].dataName;
  }
  if (Array.isArray(nodeMeta.fields)) {
    const entry = nodeMeta.fields.find(
      (field) => field && field.originalDataName === originalDataName && field.dataName
    );
    if (entry) {
      return entry.dataName;
    }
  }
  return originalDataName;
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

    this.repeatableDataNames = {
      floors: getRepeatableDataName(meta, 'floors', 'building_plan_floors'),
      rooms: getRepeatableDataName(meta, 'rooms', 'building_plan_rooms'),
      walls: getRepeatableDataName(meta, 'walls', 'room_walls'),
    };

    this.fieldNames = {
      roomVertices: getFieldDataName(meta, 'rooms', 'room_vertices'),
      wallGeometry: getFieldDataName(meta, 'walls', 'wall_geometry'),
      wallLabel: getFieldDataName(meta, 'walls', 'wall_label'),
      wallHeight: getFieldDataName(meta, 'walls', 'wall_height_m'),
      wallThickness: getFieldDataName(meta, 'walls', 'wall_thickness_m'),
    };

    const sectionElements = Array.isArray(section?.elements) ? section.elements : [];
    this.floorSection = this.resolveRepeatable(
      sectionElements,
      this.repeatableDataNames.floors,
      'building_plan_floors'
    );
    this.roomSection = this.floorSection
      ? this.resolveRepeatable(
          this.floorSection.elements || [],
          this.repeatableDataNames.rooms,
          'building_plan_rooms'
        )
      : null;
    this.wallSection = this.roomSection
      ? this.resolveRepeatable(
          this.roomSection.elements || [],
          this.repeatableDataNames.walls,
          'room_walls'
        )
      : null;

    if (this.floorSection) {
      this.repeatableDataNames.floors = this.floorSection.data_name;
    }
    if (this.roomSection) {
      this.repeatableDataNames.rooms = this.roomSection.data_name;
    }
    if (this.wallSection) {
      this.repeatableDataNames.walls = this.wallSection.data_name;
    }

    this.floorKey = this.floorSection
      ? this.formRenderer.getPreferredKey(this.floorSection)
      : getRepeatablePreferredKey(meta, 'floors', null);
    this.roomKey = this.roomSection
      ? this.formRenderer.getPreferredKey(this.roomSection)
      : getRepeatablePreferredKey(meta, 'rooms', null);
    this.wallKey = this.wallSection
      ? this.formRenderer.getPreferredKey(this.wallSection)
      : getRepeatablePreferredKey(meta, 'walls', null);

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
        if (Array.isArray(detail.instancePath)) {
          this.resetFloorValues(detail.instancePath);
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

  resolveRepeatable(elements = [], dataName, fallbackDataName) {
    const primary = dataName ? this.getRepeatableByDataName(dataName, elements) : null;
    if (primary) {
      return primary;
    }
    if (fallbackDataName && fallbackDataName !== dataName) {
      return this.getRepeatableByDataName(fallbackDataName, elements);
    }
    return null;
  }

  createRoom(rectangle) {
    if (!this.roomSection) {
      throw new Error('Building plan blueprint missing rooms definition');
    }

    const roomVerticesField = this.fieldNames.roomVertices;
    const activeFloor = this.floors[this.activeFloorIndex];
    if (!activeFloor) {
      return null;
    }

    const floorPath = [...activeFloor.path];

    this.formRenderer.addRepeatableInstance(this.roomSection, floorPath, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const roomInstances = this.formRenderer.getRepeatableInstances(this.roomSection, floorPath) || [];
    const roomIndex = roomInstances.length - 1;
    const roomInstance = roomInstances[roomIndex];
    const roomPath = [...floorPath, { key: this.roomKey, index: roomIndex }];

    const roomId = roomInstance?.id || `${this.formRenderer.formatContextPath(roomPath)}`;
    const roomVerticesValue = verticesFromRect(rectangle);
    const roundedVertices = roundVertices(roomVerticesValue);
    const roomVerticesString = stringifyValue(roundedVertices);

    if (roomInstance) {
      roomInstance.values = {};
      roomInstance.repeatable = {};
      roomInstance.values[roomVerticesField] = roomVerticesString;
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
      roomVerticesField,
      roomPath,
      roomVerticesString,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { suspendEngine: true }
    );

    return provisionalRoom;
  }

  updateRoom(roomId, rectangle) {
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) return;

    const roomVerticesField = this.fieldNames.roomVertices;
    const wallGeometryField = this.fieldNames.wallGeometry;
    const roundedVertices = roundVertices(verticesFromRect(rectangle));

    if (this.formStateManager && typeof this.formStateManager.setFieldValueAtContext === 'function') {
      this.formStateManager.setFieldValueAtContext(
        roomVerticesField,
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
          wallGeometryField,
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

  createWall(roomId, points, { triggerEngineUpdate = true, suspendEngine = false } = {}) {
    if (!this.wallSection) {
      throw new Error('Building plan blueprint missing walls definition');
    }

    const wallGeometryField = this.fieldNames.wallGeometry;
    const wallLabelField = this.fieldNames.wallLabel;
    const wallHeightField = this.fieldNames.wallHeight;
    const wallThicknessField = this.fieldNames.wallThickness;
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) return null;

    this.formRenderer.addRepeatableInstance(this.wallSection, roomInfo.path, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const wallInstances = this.formRenderer.getRepeatableInstances(this.wallSection, roomInfo.path) || [];
    const wallIndex = wallInstances.length - 1;
    const wallInstance = wallInstances[wallIndex];
    const wallPath = [...roomInfo.path, { key: this.wallKey, index: wallIndex }];

    const wallId = wallInstance?.id || `${this.formRenderer.formatContextPath(wallPath)}`;
    const roundedPoints = roundVertices(points);
    const wallPointsString = stringifyValue(roundedPoints);

    if (wallInstance) {
      wallInstance.values = {};
      wallInstance.repeatable = {};
      wallInstance.values[wallGeometryField] = wallPointsString;
      wallInstance.values[wallLabelField] = '';
      wallInstance.values[wallHeightField] = null;
      wallInstance.values[wallThicknessField] = null;
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
      wallGeometryField,
      wallPath,
      wallPointsString,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate, suspendEngine }
    );
    this.setFieldValueWithoutState(wallLabelField, wallPath, '');
    this.setFieldValueWithoutState(wallHeightField, wallPath, null);
    this.setFieldValueWithoutState(wallThicknessField, wallPath, null);

    return provisionalWall;
  }

  createFloor() {
    if (!this.floorSection) return;
    this.formRenderer.addRepeatableInstance(this.floorSection, this.contextPath, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
  }

  queueFieldUpdate(
    fieldName,
    path,
    value,
    afterUpdate = null,
    { triggerEngineUpdate = true, suspendEngine = false } = {}
  ) {
    if (
      !this.formStateManager ||
      typeof this.formStateManager.setFieldValueAtContext !== 'function' ||
      typeof this.formStateManager.updateFormState !== 'function'
    ) {
      return;
    }

    const shouldSuspend =
      suspendEngine &&
      typeof this.formStateManager.suspendEngineUpdates === 'function' &&
      typeof this.formStateManager.resumeEngineUpdates === 'function';

    if (shouldSuspend) {
      this.formStateManager.suspendEngineUpdates();
    }

    const completeUpdate = () => {
      let resumeNeeded = shouldSuspend;
      try {
        if (typeof afterUpdate === 'function') {
          afterUpdate();
        }
      } finally {
        if (resumeNeeded) {
          this.formStateManager.resumeEngineUpdates();
          resumeNeeded = false;
        }
      }
    };

    this.runAfterRender(() => {
      const success = this.formStateManager.setFieldValueAtContext(
        fieldName,
        path,
        value,
        { suppressLogging: true, skipStateUpdate: true }
      );

      if (success) {
        if (triggerEngineUpdate) {
          this.formStateManager.updateFormState();
        }
        completeUpdate();
        return;
      }

      if (typeof this.formStateManager.registerPendingFieldCallback === 'function') {
        const contextKey = this.formRenderer.formatContextPath(path);
        this.formStateManager.registerPendingFieldCallback(contextKey, fieldName, () => {
          if (triggerEngineUpdate) {
            this.formStateManager.updateFormState();
          }
          completeUpdate();
        });
        return;
      }

      completeUpdate();
    });
  }

  setFieldValueWithoutState(fieldName, path, value) {
    if (
      !this.formStateManager ||
      typeof this.formStateManager.setFieldValueAtContext !== 'function'
    ) {
      return;
    }
    this.formStateManager.setFieldValueAtContext(fieldName, path, value, {
      suppressLogging: true,
      skipStateUpdate: true,
    });
  }

  updateWall(wallId, points) {
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) return;
    const wallGeometryField = this.fieldNames.wallGeometry;
    const roundedPoints = roundVertices(points);
    wallInfo.points = cloneVertices(roundedPoints);
    if (wallInfo.previewPoints) {
      delete wallInfo.previewPoints;
    }
    this.emitUpdate();

    this.queueFieldUpdate(
      wallGeometryField,
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
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(roomInfo.path);
    }
    const container = this.formRenderer.getRepeatableInstanceContainer(roomInfo.path);
    highlightElement(container);
  }

  focusWall(wallId) {
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) return;
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(wallInfo.path);
    }
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

    const roomVerticesField = this.fieldNames.roomVertices;
    const wallGeometryField = this.wallSection ? this.fieldNames.wallGeometry : null;

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
        const vertices = roundVertices(parseVertices(roomInstance?.values?.[roomVerticesField]));
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
          const points = roundVertices(parsePoints(wallInstance?.values?.[wallGeometryField]));
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
    const roomVerticesField = this.fieldNames.roomVertices;
    const vertices = Array.isArray(room.vertices) ? room.vertices : [];
    if (vertices.length >= 4) {
      this.ensurePerimeterWalls(room);
      return;
    }

    this.resetRoomWalls(instancePath);

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
      roomVerticesField,
      instancePath,
      verticesString,
      () => {
        this.ensurePerimeterWalls(room);
      },
      { suspendEngine: true }
    );
  }

  resetRoomWalls(instancePath) {
    if (!this.wallSection) {
      return;
    }

    const roomPath = Array.isArray(instancePath) ? instancePath : [];
    const container = this.formRenderer?.getRepeatableStateContainer?.(roomPath);

    if (container && Array.isArray(container[this.wallKey]) && container[this.wallKey].length > 0) {
      container[this.wallKey] = [];
      if (typeof this.formRenderer.rebuildRepeatableSection === 'function') {
        this.formRenderer.rebuildRepeatableSection(this.wallSection, roomPath);
      }
    }

    if (
      this.formStateManager &&
      typeof this.formStateManager.clearPendingValuesUnderPath === 'function'
    ) {
      this.formStateManager.clearPendingValuesUnderPath(roomPath);
    }

    const removals = [];
    for (const [wallId, wallInfo] of this.walls.entries()) {
      if (this.pathsEqual(wallInfo.path.slice(0, -1), roomPath)) {
        removals.push(wallId);
      }
    }
    removals.forEach((wallId) => this.walls.delete(wallId));
  }

  resetFloorValues(instancePath) {
    if (
      !this.floorSection ||
      !Array.isArray(instancePath) ||
      typeof this.formRenderer?.getRepeatableInstances !== 'function'
    ) {
      return;
    }

    const floorInstances = this.formRenderer.getRepeatableInstances(
      this.floorSection,
      this.contextPath
    );
    const instanceIndex = instancePath[instancePath.length - 1]?.index ?? null;
    if (instanceIndex == null || !Array.isArray(floorInstances)) {
      return;
    }

    const floorInstance = floorInstances[instanceIndex];
    if (floorInstance) {
      floorInstance.values = {};
    }

    const floorFields = (this.floorSection.elements || []).filter((element) =>
      element &&
      typeof element === 'object' &&
      element.type &&
      element.type !== 'RepeatableSection' &&
      element.type !== 'Section' &&
      element.type !== 'BuildingPlanSection'
    );

    const defaultForField = (field) => {
      switch (field.type) {
        case 'NumericField':
          return null;
        case 'BooleanField':
        case 'MultiChoiceField':
        case 'SingleChoiceField':
          return null;
        default:
          return '';
      }
    };

    floorFields.forEach((field) => {
      const value = defaultForField(field);
      this.setFieldValueWithoutState(field.data_name, instancePath, value);
      if (floorInstance && floorInstance.values) {
        floorInstance.values[field.data_name] = value;
      }
    });
  }

  pathsEqual(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].key !== b[i].key || a[i].index !== b[i].index) {
        return false;
      }
    }
    return true;
  }

  autoPopulateWall(instancePath) {
    const wall = this.findWallByPath(instancePath);
    if (!wall) return;
    const wallGeometryField = this.fieldNames.wallGeometry;
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
      wallGeometryField,
      instancePath,
      stringifyValue(defaultPoints),
      null,
      { suspendEngine: true }
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
      this.createWall(room.id, edge, { suspendEngine: true });
    });

    this.initializeWallDefaults(room);
  }

  initializeWallDefaults(room) {
    if (!this.wallSection) return;
    const wallInstances = this.formRenderer.getRepeatableInstances(this.wallSection, room.path) || [];
    const wallGeometryField = this.fieldNames.wallGeometry;
    const wallLabelField = this.fieldNames.wallLabel;
    const wallHeightField = this.fieldNames.wallHeight;
    const wallThicknessField = this.fieldNames.wallThickness;

    wallInstances.forEach((wallInstance, wallIndex) => {
      if (!wallInstance) return;

      if (!wallInstance.values || typeof wallInstance.values !== 'object') {
        wallInstance.values = {};
      }

      const wallPath = [...room.path, { key: this.wallKey, index: wallIndex }];
      const geometryPoints = Array.isArray(wallInstance.points) ? wallInstance.points : [];
      const roundedPoints = roundVertices(geometryPoints);
      const geometryValue = stringifyValue(roundedPoints);

      wallInstance.points = cloneVertices(roundedPoints);
      wallInstance.values[wallGeometryField] = geometryValue;
      wallInstance.values[wallLabelField] = '';
      wallInstance.values[wallHeightField] = null;
      wallInstance.values[wallThicknessField] = null;

      this.setFieldValueWithoutState(wallGeometryField, wallPath, geometryValue);
      this.setFieldValueWithoutState(wallLabelField, wallPath, '');
      this.setFieldValueWithoutState(wallHeightField, wallPath, null);
      this.setFieldValueWithoutState(wallThicknessField, wallPath, null);
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
