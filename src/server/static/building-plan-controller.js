function cloneVertices(vertices = []) {
  return Array.isArray(vertices) ? vertices.map((point) => ({ ...point })) : [];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInteger(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const int = parseInt(value, 10);
  return Number.isNaN(int) ? fallback : int;
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
const DEFAULT_DOOR_WIDTH = 0.9;
const DEFAULT_DOOR_HEIGHT = 2;
const DEFAULT_WINDOW_WIDTH = 1.2;
const DEFAULT_WINDOW_HEIGHT = 1.2;
const DEFAULT_WINDOW_SILL_HEIGHT = 0.9;
const DEFAULT_COLUMN_WIDTH = 0.3;
const DEFAULT_COLUMN_HEIGHT = 3;
const DEFAULT_BEAM_WIDTH = 0.25;
const DEFAULT_BEAM_HEIGHT = 0.4;

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

function distanceBetweenPoints(a, b) {
  if (!a || !b) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
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
      columns: getRepeatableDataName(meta, 'columns', 'room_columns'),
      beams: getRepeatableDataName(meta, 'beams', 'room_beams'),
      doors: getRepeatableDataName(meta, 'doors', 'wall_doors'),
      windows: getRepeatableDataName(meta, 'windows', 'wall_windows'),
    };

    this.fieldNames = {
      roomVertices: getFieldDataName(meta, 'rooms', 'room_vertices'),
      wallGeometry: getFieldDataName(meta, 'walls', 'wall_geometry'),
      wallLabel: getFieldDataName(meta, 'walls', 'wall_label'),
      wallHeight: getFieldDataName(meta, 'walls', 'wall_height_m'),
      wallThickness: getFieldDataName(meta, 'walls', 'wall_thickness_m'),
      column: {
        label: getFieldDataName(meta, 'columns', 'column_identifier'),
        width: getFieldDataName(meta, 'columns', 'column_cross_section_width_m'),
        height: getFieldDataName(meta, 'columns', 'column_cross_section_height_m'),
        vertical: getFieldDataName(meta, 'columns', 'column_height_m'),
        centerU: getFieldDataName(meta, 'columns', 'column_center_u'),
        centerV: getFieldDataName(meta, 'columns', 'column_center_v'),
        wallSegmentIndex: getFieldDataName(meta, 'columns', 'column_wall_segment_index'),
        wallRatio: getFieldDataName(meta, 'columns', 'column_wall_ratio'),
      },
      beam: {
        label: getFieldDataName(meta, 'beams', 'beam_identifier'),
        width: getFieldDataName(meta, 'beams', 'beam_cross_section_width_m'),
        height: getFieldDataName(meta, 'beams', 'beam_cross_section_height_m'),
        length: getFieldDataName(meta, 'beams', 'beam_length_m'),
        startU: getFieldDataName(meta, 'beams', 'beam_start_u'),
        startV: getFieldDataName(meta, 'beams', 'beam_start_v'),
        endU: getFieldDataName(meta, 'beams', 'beam_end_u'),
        endV: getFieldDataName(meta, 'beams', 'beam_end_v'),
        wallSegmentIndex: getFieldDataName(meta, 'beams', 'beam_wall_segment_index'),
        startRatio: getFieldDataName(meta, 'beams', 'beam_start_ratio'),
        endRatio: getFieldDataName(meta, 'beams', 'beam_end_ratio'),
      },
      door: {
        label: getFieldDataName(meta, 'doors', 'door_label'),
        width: getFieldDataName(meta, 'doors', 'door_width_m'),
        height: getFieldDataName(meta, 'doors', 'door_height_m'),
        segmentIndex: getFieldDataName(meta, 'doors', 'door_segment_index'),
        startRatio: getFieldDataName(meta, 'doors', 'door_start_ratio'),
        endRatio: getFieldDataName(meta, 'doors', 'door_end_ratio'),
        wallReference: getFieldDataName(meta, 'doors', 'door_wall_reference'),
      },
      window: {
        label: getFieldDataName(meta, 'windows', 'window_label'),
        width: getFieldDataName(meta, 'windows', 'window_width_m'),
        height: getFieldDataName(meta, 'windows', 'window_height_m'),
        distanceFromFloor: getFieldDataName(meta, 'windows', 'window_distance_from_floor_m'),
        segmentIndex: getFieldDataName(meta, 'windows', 'window_segment_index'),
        startRatio: getFieldDataName(meta, 'windows', 'window_start_ratio'),
        endRatio: getFieldDataName(meta, 'windows', 'window_end_ratio'),
        wallReference: getFieldDataName(meta, 'windows', 'window_wall_reference'),
      },
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
    this.columnSection = this.roomSection
      ? this.resolveRepeatable(
          this.roomSection.elements || [],
          this.repeatableDataNames.columns,
          'room_columns'
        )
      : null;
    this.beamSection = this.roomSection
      ? this.resolveRepeatable(
          this.roomSection.elements || [],
          this.repeatableDataNames.beams,
          'room_beams'
        )
      : null;
    this.doorSection = this.wallSection
      ? this.resolveRepeatable(
          this.wallSection.elements || [],
          this.repeatableDataNames.doors,
          'wall_doors'
        )
      : null;
    this.windowSection = this.wallSection
      ? this.resolveRepeatable(
          this.wallSection.elements || [],
          this.repeatableDataNames.windows,
          'wall_windows'
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
    if (this.columnSection) {
      this.repeatableDataNames.columns = this.columnSection.data_name;
    }
    if (this.beamSection) {
      this.repeatableDataNames.beams = this.beamSection.data_name;
    }
    if (this.doorSection) {
      this.repeatableDataNames.doors = this.doorSection.data_name;
    }
    if (this.windowSection) {
      this.repeatableDataNames.windows = this.windowSection.data_name;
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
    this.columnKey = this.columnSection
      ? this.formRenderer.getPreferredKey(this.columnSection)
      : getRepeatablePreferredKey(meta, 'columns', null);
    this.beamKey = this.beamSection
      ? this.formRenderer.getPreferredKey(this.beamSection)
      : getRepeatablePreferredKey(meta, 'beams', null);
    this.doorKey = this.doorSection
      ? this.formRenderer.getPreferredKey(this.doorSection)
      : getRepeatablePreferredKey(meta, 'doors', null);
    this.windowKey = this.windowSection
      ? this.formRenderer.getPreferredKey(this.windowSection)
      : getRepeatablePreferredKey(meta, 'windows', null);

    this.rooms = new Map();
    this.walls = new Map();
    this.columns = new Map();
    this.beams = new Map();
    this.doors = new Map();
    this.windows = new Map();
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

    const relevantKeys = new Set(
      [
        this.roomKey,
        this.wallKey,
        this.columnKey,
        this.beamKey,
        this.floorKey,
        this.doorKey,
        this.windowKey,
      ].filter(
        (value) => typeof value === 'string' && value !== ''
      )
    );
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
      } else if (detail.sectionKey === this.columnKey) {
        this.autoPopulateColumn(detail.instancePath);
      } else if (detail.sectionKey === this.beamKey) {
        this.autoPopulateBeam(detail.instancePath);
      } else if (detail.sectionKey === this.doorKey) {
        this.autoPopulateDoor(detail.instancePath);
      } else if (detail.sectionKey === this.windowKey) {
        this.autoPopulateWindow(detail.instancePath);
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
      index: wallIndex,
      points: cloneVertices(roundedPoints),
      doors: [],
      windows: [],
      label: '',
      displayLabel: `W#${wallIndex + 1}`,
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

  createColumn(
    roomId,
    {
      centerU = 0.5,
      centerV = 0.5,
      width = DEFAULT_COLUMN_WIDTH,
      height = DEFAULT_COLUMN_WIDTH,
      vertical = DEFAULT_COLUMN_HEIGHT,
      wallSegmentIndex = -1,
      wallRatio = 0,
      label = '',
      triggerEngineUpdate = true,
    } = {}
  ) {
    if (!this.columnSection) {
      console.warn('[BuildingPlan] Column repeatable definition missing');
      return null;
    }
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo) {
      console.warn('[BuildingPlan] Cannot create column: room not found', roomId);
      return null;
    }

    this.formRenderer.addRepeatableInstance(this.columnSection, roomInfo.path, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const columnInstances = this.formRenderer.getRepeatableInstances(this.columnSection, roomInfo.path) || [];
    const columnIndex = columnInstances.length - 1;
    const columnInstance = columnInstances[columnIndex];
    const columnPath = [...roomInfo.path, { key: this.columnKey, index: columnIndex }];
    const columnId = columnInstance?.id || `${this.formRenderer.formatContextPath(columnPath)}`;
    const columnFields = this.fieldNames.column;

    const sanitizedCenterU = clamp(roundCoordinate(toNumber(centerU, 0.5)), 0, 1);
    const sanitizedCenterV = clamp(roundCoordinate(toNumber(centerV, 0.5)), 0, 1);
    const sanitizedWidth = roundCoordinate(toNumber(width, DEFAULT_COLUMN_WIDTH));
    const sanitizedHeight = roundCoordinate(toNumber(height, DEFAULT_COLUMN_WIDTH));
    const sanitizedVertical = roundCoordinate(toNumber(vertical, DEFAULT_COLUMN_HEIGHT));
    const sanitizedSegment = toInteger(wallSegmentIndex, -1);
    const sanitizedRatio = clamp(roundCoordinate(toNumber(wallRatio, 0)), 0, 1);
    const resolvedLabel =
      label && String(label).trim() !== ''
        ? String(label).trim()
        : `C#${columnInstances.length}`;

    if (columnInstance) {
      columnInstance.values = columnInstance.values || {};
      columnInstance.values[columnFields.label] = resolvedLabel;
      columnInstance.values[columnFields.width] = sanitizedWidth;
      columnInstance.values[columnFields.height] = sanitizedHeight;
      columnInstance.values[columnFields.vertical] = sanitizedVertical;
      columnInstance.values[columnFields.centerU] = sanitizedCenterU;
      columnInstance.values[columnFields.centerV] = sanitizedCenterV;
      columnInstance.values[columnFields.wallSegmentIndex] = sanitizedSegment;
      columnInstance.values[columnFields.wallRatio] = sanitizedRatio;
    }

    const provisionalColumn = {
      id: columnId,
      roomId,
      floorIndex: roomInfo.floorIndex,
      path: columnPath,
      index: columnIndex,
      width: sanitizedWidth,
      height: sanitizedHeight,
      vertical: sanitizedVertical,
      centerU: sanitizedCenterU,
      centerV: sanitizedCenterV,
      wallSegmentIndex: sanitizedSegment,
      wallRatio: sanitizedRatio,
      label: resolvedLabel,
      displayLabel: resolvedLabel,
    };

    this.columns.set(columnId, provisionalColumn);
    this.emitUpdate();

    this.setFieldValueWithoutState(columnFields.label, columnPath, resolvedLabel);
    this.setFieldValueWithoutState(columnFields.width, columnPath, sanitizedWidth);
    this.setFieldValueWithoutState(columnFields.height, columnPath, sanitizedHeight);
    this.setFieldValueWithoutState(columnFields.vertical, columnPath, sanitizedVertical);
    this.setFieldValueWithoutState(columnFields.centerV, columnPath, sanitizedCenterV);
    this.setFieldValueWithoutState(columnFields.wallSegmentIndex, columnPath, sanitizedSegment);
    this.setFieldValueWithoutState(columnFields.wallRatio, columnPath, sanitizedRatio);

    this.queueFieldUpdate(
      columnFields.centerU,
      columnPath,
      sanitizedCenterU,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );

    return provisionalColumn;
  }

  updateColumn(
    columnId,
    updates = {},
    { triggerEngineUpdate = true } = {}
  ) {
    const columnInfo = this.columns.get(columnId);
    if (!columnInfo || !this.columnSection) {
      return;
    }

    const columnFields = this.fieldNames.column;
    const columnPath = columnInfo.path;
    const parentPath = columnPath.slice(0, -1);
    const columnIndex = columnPath[columnPath.length - 1]?.index ?? null;
    const instances =
      this.formRenderer.getRepeatableInstances(this.columnSection, parentPath) || [];
    const columnInstance = columnIndex != null ? instances[columnIndex] : null;
    if (columnInstance) {
      columnInstance.values = columnInstance.values || {};
    }

    const nextWidth =
      updates.width != null ? roundCoordinate(toNumber(updates.width, columnInfo.width)) : columnInfo.width;
    const nextHeight =
      updates.height != null
        ? roundCoordinate(toNumber(updates.height, columnInfo.height))
        : columnInfo.height;
    const nextVertical =
      updates.vertical != null
        ? roundCoordinate(toNumber(updates.vertical, columnInfo.vertical))
        : columnInfo.vertical;
    const nextCenterU = updates.centerU != null
      ? clamp(roundCoordinate(toNumber(updates.centerU, columnInfo.centerU)), 0, 1)
      : columnInfo.centerU;
    const nextCenterV = updates.centerV != null
      ? clamp(roundCoordinate(toNumber(updates.centerV, columnInfo.centerV)), 0, 1)
      : columnInfo.centerV;
    const nextSegment = updates.wallSegmentIndex != null
      ? toInteger(updates.wallSegmentIndex, columnInfo.wallSegmentIndex)
      : columnInfo.wallSegmentIndex;
    const nextRatio = updates.wallRatio != null
      ? clamp(roundCoordinate(toNumber(updates.wallRatio, columnInfo.wallRatio)), 0, 1)
      : columnInfo.wallRatio;
    const nextLabel =
      updates.label != null && String(updates.label).trim() !== ''
        ? String(updates.label).trim()
        : columnInfo.label;

    columnInfo.width = nextWidth;
    columnInfo.height = nextHeight;
    columnInfo.vertical = nextVertical;
    columnInfo.centerU = nextCenterU;
    columnInfo.centerV = nextCenterV;
    columnInfo.wallSegmentIndex = nextSegment;
    columnInfo.wallRatio = nextRatio;
    columnInfo.label = nextLabel;
    columnInfo.displayLabel =
      nextLabel && nextLabel.trim() !== ''
        ? nextLabel
        : `C#${(columnInfo.index ?? 0) + 1}`;

    if (columnInstance) {
      columnInstance.values[columnFields.label] = nextLabel;
      columnInstance.values[columnFields.width] = nextWidth;
      columnInstance.values[columnFields.height] = nextHeight;
      columnInstance.values[columnFields.vertical] = nextVertical;
      columnInstance.values[columnFields.centerU] = nextCenterU;
      columnInstance.values[columnFields.centerV] = nextCenterV;
      columnInstance.values[columnFields.wallSegmentIndex] = nextSegment;
      columnInstance.values[columnFields.wallRatio] = nextRatio;
    }

    this.setFieldValueWithoutState(columnFields.label, columnPath, nextLabel);
    this.setFieldValueWithoutState(columnFields.width, columnPath, nextWidth);
    this.setFieldValueWithoutState(columnFields.height, columnPath, nextHeight);
    this.setFieldValueWithoutState(columnFields.vertical, columnPath, nextVertical);
    this.setFieldValueWithoutState(columnFields.centerV, columnPath, nextCenterV);
    this.setFieldValueWithoutState(columnFields.wallSegmentIndex, columnPath, nextSegment);
    this.setFieldValueWithoutState(columnFields.wallRatio, columnPath, nextRatio);

    this.queueFieldUpdate(
      columnFields.centerU,
      columnPath,
      nextCenterU,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );
  }

  removeColumn(columnId) {
    if (!this.columnSection) return;
    const columnInfo = this.columns.get(columnId);
    if (!columnInfo) return;
    const parentPath = columnInfo.path.slice(0, -1);
    const indexDescriptor = columnInfo.path[columnInfo.path.length - 1];
    if (!indexDescriptor) return;
    this.formRenderer.removeRepeatableInstance(this.columnSection, parentPath, indexDescriptor.index);
  }

  createBeam(
    roomId,
    {
      startU = 0.2,
      startV = 0.3,
      endU = 0.8,
      endV = 0.3,
      width = DEFAULT_BEAM_WIDTH,
      height = DEFAULT_BEAM_HEIGHT,
      wallSegmentIndex = -1,
      startRatio = 0,
      endRatio = 0,
      label = '',
      triggerEngineUpdate = true,
    } = {}
  ) {
    if (!this.beamSection) {
      console.warn('[BuildingPlan] Beam repeatable definition missing');
      return null;
    }
    const roomInfo = this.rooms.get(roomId);
    if (!roomInfo || !roomInfo.rect) {
      console.warn('[BuildingPlan] Cannot create beam: room not found', roomId);
      return null;
    }

    this.formRenderer.addRepeatableInstance(this.beamSection, roomInfo.path, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const beamInstances = this.formRenderer.getRepeatableInstances(this.beamSection, roomInfo.path) || [];
    const beamIndex = beamInstances.length - 1;
    const beamInstance = beamInstances[beamIndex];
    const beamPath = [...roomInfo.path, { key: this.beamKey, index: beamIndex }];
    const beamId = beamInstance?.id || `${this.formRenderer.formatContextPath(beamPath)}`;
    const beamFields = this.fieldNames.beam;

    const sanitizedStartU = clamp(roundCoordinate(toNumber(startU, 0.2)), 0, 1);
    const sanitizedStartV = clamp(roundCoordinate(toNumber(startV, 0.3)), 0, 1);
    const sanitizedEndU = clamp(roundCoordinate(toNumber(endU, 0.8)), 0, 1);
    const sanitizedEndV = clamp(roundCoordinate(toNumber(endV, sanitizedStartV)), 0, 1);
    const sanitizedWidth = roundCoordinate(toNumber(width, DEFAULT_BEAM_WIDTH));
    const sanitizedHeight = roundCoordinate(toNumber(height, DEFAULT_BEAM_HEIGHT));
    const sanitizedSegment = toInteger(wallSegmentIndex, -1);
    const sanitizedStartRatio = clamp(roundCoordinate(toNumber(startRatio, 0)), 0, 1);
    const sanitizedEndRatio = clamp(roundCoordinate(toNumber(endRatio, 0)), 0, 1);
    const resolvedLabel =
      label && String(label).trim() !== ''
        ? String(label).trim()
        : `B#${beamInstances.length}`;

    const startPoint = {
      x: roomInfo.rect.x + sanitizedStartU * roomInfo.rect.width,
      y: roomInfo.rect.y + sanitizedStartV * roomInfo.rect.height,
    };
    const endPoint = {
      x: roomInfo.rect.x + sanitizedEndU * roomInfo.rect.width,
      y: roomInfo.rect.y + sanitizedEndV * roomInfo.rect.height,
    };
    const lengthMeters = roundCoordinate(distanceBetweenPoints(startPoint, endPoint));

    if (beamInstance) {
      beamInstance.values = beamInstance.values || {};
      beamInstance.values[beamFields.label] = resolvedLabel;
      beamInstance.values[beamFields.width] = sanitizedWidth;
      beamInstance.values[beamFields.height] = sanitizedHeight;
      beamInstance.values[beamFields.startU] = sanitizedStartU;
      beamInstance.values[beamFields.startV] = sanitizedStartV;
      beamInstance.values[beamFields.endU] = sanitizedEndU;
      beamInstance.values[beamFields.endV] = sanitizedEndV;
      beamInstance.values[beamFields.wallSegmentIndex] = sanitizedSegment;
      beamInstance.values[beamFields.startRatio] = sanitizedStartRatio;
      beamInstance.values[beamFields.endRatio] = sanitizedEndRatio;
      beamInstance.values[beamFields.length] = lengthMeters;
    }

    const provisionalBeam = {
      id: beamId,
      roomId,
      floorIndex: roomInfo.floorIndex,
      path: beamPath,
      index: beamIndex,
      width: sanitizedWidth,
      height: sanitizedHeight,
      startU: sanitizedStartU,
      startV: sanitizedStartV,
      endU: sanitizedEndU,
      endV: sanitizedEndV,
      wallSegmentIndex: sanitizedSegment,
      startRatio: sanitizedStartRatio,
      endRatio: sanitizedEndRatio,
      length: lengthMeters,
      label: resolvedLabel,
      displayLabel: resolvedLabel,
    };

    this.beams.set(beamId, provisionalBeam);
    this.emitUpdate();

    this.setFieldValueWithoutState(beamFields.label, beamPath, resolvedLabel);
    this.setFieldValueWithoutState(beamFields.width, beamPath, sanitizedWidth);
    this.setFieldValueWithoutState(beamFields.height, beamPath, sanitizedHeight);
    this.setFieldValueWithoutState(beamFields.startU, beamPath, sanitizedStartU);
    this.setFieldValueWithoutState(beamFields.startV, beamPath, sanitizedStartV);
    this.setFieldValueWithoutState(beamFields.endU, beamPath, sanitizedEndU);
    this.setFieldValueWithoutState(beamFields.endV, beamPath, sanitizedEndV);
    this.setFieldValueWithoutState(beamFields.wallSegmentIndex, beamPath, sanitizedSegment);
    this.setFieldValueWithoutState(beamFields.startRatio, beamPath, sanitizedStartRatio);
    this.setFieldValueWithoutState(beamFields.endRatio, beamPath, sanitizedEndRatio);
    this.setFieldValueWithoutState(beamFields.length, beamPath, lengthMeters);

    this.queueFieldUpdate(
      beamFields.startU,
      beamPath,
      sanitizedStartU,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );

    return provisionalBeam;
  }

  updateBeam(
    beamId,
    updates = {},
    { triggerEngineUpdate = true } = {}
  ) {
    const beamInfo = this.beams.get(beamId);
    if (!beamInfo || !this.beamSection) {
      return;
    }

    const beamFields = this.fieldNames.beam;
    const beamPath = beamInfo.path;
    const parentPath = beamPath.slice(0, -1);
    const beamIndex = beamPath[beamPath.length - 1]?.index ?? null;
    const instances = this.formRenderer.getRepeatableInstances(this.beamSection, parentPath) || [];
    const beamInstance = beamIndex != null ? instances[beamIndex] : null;
    if (beamInstance) {
      beamInstance.values = beamInstance.values || {};
    }

    const nextWidth =
      updates.width != null ? roundCoordinate(toNumber(updates.width, beamInfo.width)) : beamInfo.width;
    const nextHeight =
      updates.height != null ? roundCoordinate(toNumber(updates.height, beamInfo.height)) : beamInfo.height;
    const nextStartU =
      updates.startU != null
        ? clamp(roundCoordinate(toNumber(updates.startU, beamInfo.startU)), 0, 1)
        : beamInfo.startU;
    const nextStartV =
      updates.startV != null
        ? clamp(roundCoordinate(toNumber(updates.startV, beamInfo.startV)), 0, 1)
        : beamInfo.startV;
    const nextEndU =
      updates.endU != null
        ? clamp(roundCoordinate(toNumber(updates.endU, beamInfo.endU)), 0, 1)
        : beamInfo.endU;
    const nextEndV =
      updates.endV != null
        ? clamp(roundCoordinate(toNumber(updates.endV, beamInfo.endV)), 0, 1)
        : beamInfo.endV;
    const nextSegment =
      updates.wallSegmentIndex != null
        ? toInteger(updates.wallSegmentIndex, beamInfo.wallSegmentIndex)
        : beamInfo.wallSegmentIndex;
    const nextStartRatio =
      updates.startRatio != null
        ? clamp(roundCoordinate(toNumber(updates.startRatio, beamInfo.startRatio)), 0, 1)
        : beamInfo.startRatio;
    const nextEndRatio =
      updates.endRatio != null
        ? clamp(roundCoordinate(toNumber(updates.endRatio, beamInfo.endRatio)), 0, 1)
        : beamInfo.endRatio;
    const nextLabel =
      updates.label != null && String(updates.label).trim() !== ''
        ? String(updates.label).trim()
        : beamInfo.label;

    const roomInfo = this.rooms.get(beamInfo.roomId);
    const startPoint = roomInfo
      ? {
          x: roomInfo.rect.x + nextStartU * roomInfo.rect.width,
          y: roomInfo.rect.y + nextStartV * roomInfo.rect.height,
        }
      : { x: 0, y: 0 };
    const endPoint = roomInfo
      ? {
          x: roomInfo.rect.x + nextEndU * roomInfo.rect.width,
          y: roomInfo.rect.y + nextEndV * roomInfo.rect.height,
        }
      : { x: 0, y: 0 };
    const nextLength = roundCoordinate(distanceBetweenPoints(startPoint, endPoint));

    beamInfo.width = nextWidth;
    beamInfo.height = nextHeight;
    beamInfo.startU = nextStartU;
    beamInfo.startV = nextStartV;
    beamInfo.endU = nextEndU;
    beamInfo.endV = nextEndV;
    beamInfo.wallSegmentIndex = nextSegment;
    beamInfo.startRatio = nextStartRatio;
    beamInfo.endRatio = nextEndRatio;
    beamInfo.length = nextLength;
    beamInfo.label = nextLabel;
    beamInfo.displayLabel =
      nextLabel && nextLabel.trim() !== ''
        ? nextLabel
        : `B#${(beamInfo.index ?? 0) + 1}`;

    if (beamInstance) {
      beamInstance.values[beamFields.label] = nextLabel;
      beamInstance.values[beamFields.width] = nextWidth;
      beamInstance.values[beamFields.height] = nextHeight;
      beamInstance.values[beamFields.startU] = nextStartU;
      beamInstance.values[beamFields.startV] = nextStartV;
      beamInstance.values[beamFields.endU] = nextEndU;
      beamInstance.values[beamFields.endV] = nextEndV;
      beamInstance.values[beamFields.wallSegmentIndex] = nextSegment;
      beamInstance.values[beamFields.startRatio] = nextStartRatio;
      beamInstance.values[beamFields.endRatio] = nextEndRatio;
      beamInstance.values[beamFields.length] = nextLength;
    }

    this.setFieldValueWithoutState(beamFields.label, beamPath, nextLabel);
    this.setFieldValueWithoutState(beamFields.width, beamPath, nextWidth);
    this.setFieldValueWithoutState(beamFields.height, beamPath, nextHeight);
    this.setFieldValueWithoutState(beamFields.startU, beamPath, nextStartU);
    this.setFieldValueWithoutState(beamFields.startV, beamPath, nextStartV);
    this.setFieldValueWithoutState(beamFields.endU, beamPath, nextEndU);
    this.setFieldValueWithoutState(beamFields.endV, beamPath, nextEndV);
    this.setFieldValueWithoutState(beamFields.wallSegmentIndex, beamPath, nextSegment);
    this.setFieldValueWithoutState(beamFields.startRatio, beamPath, nextStartRatio);
    this.setFieldValueWithoutState(beamFields.endRatio, beamPath, nextEndRatio);
    this.setFieldValueWithoutState(beamFields.length, beamPath, nextLength);

    this.queueFieldUpdate(
      beamFields.startU,
      beamPath,
      nextStartU,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );
  }

  removeBeam(beamId) {
    if (!this.beamSection) return;
    const beamInfo = this.beams.get(beamId);
    if (!beamInfo) return;
    const parentPath = beamInfo.path.slice(0, -1);
    const indexDescriptor = beamInfo.path[beamInfo.path.length - 1];
    if (!indexDescriptor) return;
    this.formRenderer.removeRepeatableInstance(this.beamSection, parentPath, indexDescriptor.index);
  }

  createDoor(
    wallId,
    {
      segmentIndex = 0,
      startRatio = 0.4,
      endRatio = 0.6,
      width = DEFAULT_DOOR_WIDTH,
      height = DEFAULT_DOOR_HEIGHT,
      label = '',
      triggerEngineUpdate = true,
    } = {}
  ) {
    if (!this.doorSection) {
      console.warn('[BuildingPlan] Door repeatable definition missing');
      return null;
    }
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) {
      console.warn('[BuildingPlan] Cannot create door: wall not found', wallId);
      return null;
    }

    this.formRenderer.addRepeatableInstance(this.doorSection, wallInfo.path, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const doorInstances = this.formRenderer.getRepeatableInstances(this.doorSection, wallInfo.path) || [];
    const doorIndex = doorInstances.length - 1;
    const doorInstance = doorInstances[doorIndex];
    const doorPath = [...wallInfo.path, { key: this.doorKey, index: doorIndex }];
    const doorId = doorInstance?.id || `${this.formRenderer.formatContextPath(doorPath)}`;
    const doorFields = this.fieldNames.door;
    const maxSegmentIndex = Math.max(0, (wallInfo.points || []).length - 2);
    const sanitizedSegment = clamp(toInteger(segmentIndex, 0), 0, maxSegmentIndex);
    const startValue = toNumber(startRatio, 0.4);
    const endValue = toNumber(endRatio, 0.6);
    const normalizedStart = clamp(
      roundCoordinate(Math.min(startValue, endValue)),
      0,
      1
    );
    const normalizedEnd = clamp(
      roundCoordinate(Math.max(startValue, endValue)),
      0,
      1
    );
    const sanitizedWidth = roundCoordinate(toNumber(width, DEFAULT_DOOR_WIDTH));
    const sanitizedHeight = roundCoordinate(toNumber(height, DEFAULT_DOOR_HEIGHT));
    const resolvedLabel =
      label && String(label).trim() !== '' ? String(label).trim() : `D#${doorIndex + 1}`;

    if (doorInstance) {
      doorInstance.values = doorInstance.values || {};
      doorInstance.values[doorFields.segmentIndex] = sanitizedSegment;
      doorInstance.values[doorFields.startRatio] = normalizedStart;
      doorInstance.values[doorFields.endRatio] = normalizedEnd;
      doorInstance.values[doorFields.width] = sanitizedWidth;
      doorInstance.values[doorFields.height] = sanitizedHeight;
      doorInstance.values[doorFields.label] = resolvedLabel;
      doorInstance.values[doorFields.wallReference] = wallId;
    }

    const provisionalDoor = {
      id: doorId,
      wallId,
      roomId: wallInfo.roomId,
      floorIndex: wallInfo.floorIndex,
      path: doorPath,
      segmentIndex: sanitizedSegment,
      startRatio: normalizedStart,
      endRatio: normalizedEnd,
      width: sanitizedWidth,
      height: sanitizedHeight,
      label: resolvedLabel,
      wallReference: wallId,
    };

    this.doors.set(doorId, provisionalDoor);
    if (Array.isArray(wallInfo.doors)) {
      wallInfo.doors.push(doorId);
    } else {
      wallInfo.doors = [doorId];
    }
    this.emitUpdate();

    this.setFieldValueWithoutState(doorFields.segmentIndex, doorPath, sanitizedSegment);
    this.setFieldValueWithoutState(doorFields.endRatio, doorPath, normalizedEnd);
    this.setFieldValueWithoutState(doorFields.width, doorPath, sanitizedWidth);
    this.setFieldValueWithoutState(doorFields.height, doorPath, sanitizedHeight);
    this.setFieldValueWithoutState(doorFields.label, doorPath, resolvedLabel);
    this.setFieldValueWithoutState(doorFields.wallReference, doorPath, wallId);

    this.queueFieldUpdate(
      doorFields.startRatio,
      doorPath,
      normalizedStart,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );

    return provisionalDoor;
  }

  createWindow(
    wallId,
    {
      segmentIndex = 0,
      startRatio = 0.4,
      endRatio = 0.6,
      width = DEFAULT_WINDOW_WIDTH,
      height = DEFAULT_WINDOW_HEIGHT,
      distanceFromFloor = DEFAULT_WINDOW_SILL_HEIGHT,
      label = '',
      triggerEngineUpdate = true,
    } = {}
  ) {
    if (!this.windowSection) {
      console.warn('[BuildingPlan] Window repeatable definition missing');
      return null;
    }
    const wallInfo = this.walls.get(wallId);
    if (!wallInfo) {
      console.warn('[BuildingPlan] Cannot create window: wall not found', wallId);
      return null;
    }

    this.formRenderer.addRepeatableInstance(this.windowSection, wallInfo.path, {
      clearNewInstanceValues: true,
      clearNewInstanceRepeatable: true,
    });
    const windowInstances = this.formRenderer.getRepeatableInstances(this.windowSection, wallInfo.path) || [];
    const windowIndex = windowInstances.length - 1;
    const windowInstance = windowInstances[windowIndex];
    const windowPath = [...wallInfo.path, { key: this.windowKey, index: windowIndex }];
    const windowId =
      windowInstance?.id || `${this.formRenderer.formatContextPath(windowPath)}`;
    const windowFields = this.fieldNames.window;
    const maxSegmentIndex = Math.max(0, (wallInfo.points || []).length - 2);
    const sanitizedSegment = clamp(toInteger(segmentIndex, 0), 0, maxSegmentIndex);
    const startValue = toNumber(startRatio, 0.4);
    const endValue = toNumber(endRatio, 0.6);
    const normalizedStart = clamp(
      roundCoordinate(Math.min(startValue, endValue)),
      0,
      1
    );
    const normalizedEnd = clamp(
      roundCoordinate(Math.max(startValue, endValue)),
      0,
      1
    );
    const sanitizedWidth = roundCoordinate(toNumber(width, DEFAULT_WINDOW_WIDTH));
    const sanitizedHeight = roundCoordinate(toNumber(height, DEFAULT_WINDOW_HEIGHT));
    const sanitizedDistance = roundCoordinate(
      toNumber(distanceFromFloor, DEFAULT_WINDOW_SILL_HEIGHT)
    );
    const resolvedLabel =
      label && String(label).trim() !== '' ? String(label).trim() : `W#${windowIndex + 1}`;

    if (windowInstance) {
      windowInstance.values = windowInstance.values || {};
      windowInstance.values[windowFields.segmentIndex] = sanitizedSegment;
      windowInstance.values[windowFields.startRatio] = normalizedStart;
      windowInstance.values[windowFields.endRatio] = normalizedEnd;
      windowInstance.values[windowFields.width] = sanitizedWidth;
      windowInstance.values[windowFields.height] = sanitizedHeight;
      windowInstance.values[windowFields.distanceFromFloor] = sanitizedDistance;
      windowInstance.values[windowFields.label] = resolvedLabel;
      windowInstance.values[windowFields.wallReference] = wallId;
    }

    const provisionalWindow = {
      id: windowId,
      wallId,
      roomId: wallInfo.roomId,
      floorIndex: wallInfo.floorIndex,
      path: windowPath,
      segmentIndex: sanitizedSegment,
      startRatio: normalizedStart,
      endRatio: normalizedEnd,
      width: sanitizedWidth,
      height: sanitizedHeight,
      distanceFromFloor: sanitizedDistance,
      label: resolvedLabel,
      wallReference: wallId,
    };

    this.windows.set(windowId, provisionalWindow);
    if (Array.isArray(wallInfo.windows)) {
      wallInfo.windows.push(windowId);
    } else {
      wallInfo.windows = [windowId];
    }
    this.emitUpdate();

    this.setFieldValueWithoutState(windowFields.segmentIndex, windowPath, sanitizedSegment);
    this.setFieldValueWithoutState(windowFields.endRatio, windowPath, normalizedEnd);
    this.setFieldValueWithoutState(windowFields.width, windowPath, sanitizedWidth);
    this.setFieldValueWithoutState(windowFields.height, windowPath, sanitizedHeight);
    this.setFieldValueWithoutState(
      windowFields.distanceFromFloor,
      windowPath,
      sanitizedDistance
    );
    this.setFieldValueWithoutState(windowFields.label, windowPath, resolvedLabel);
    this.setFieldValueWithoutState(windowFields.wallReference, windowPath, wallId);

    this.queueFieldUpdate(
      windowFields.startRatio,
      windowPath,
      normalizedStart,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );

    return provisionalWindow;
  }

  updateDoor(
    doorId,
    updates = {},
    { triggerEngineUpdate = true } = {}
  ) {
    const doorInfo = this.doors.get(doorId);
    if (!doorInfo || !this.doorSection) {
      return;
    }

    const wallInfo = this.walls.get(doorInfo.wallId);
    const maxSegmentIndex = Math.max(0, (wallInfo?.points || []).length - 2);
    const nextSegment =
      updates.segmentIndex != null
        ? clamp(toInteger(updates.segmentIndex, doorInfo.segmentIndex), 0, maxSegmentIndex)
        : doorInfo.segmentIndex;
    const nextStartRaw =
      updates.startRatio != null
        ? toNumber(updates.startRatio, doorInfo.startRatio)
        : doorInfo.startRatio;
    const nextEndRaw =
      updates.endRatio != null
        ? toNumber(updates.endRatio, doorInfo.endRatio)
        : doorInfo.endRatio;
    const nextStart = clamp(roundCoordinate(Math.min(nextStartRaw, nextEndRaw)), 0, 1);
    const nextEnd = clamp(roundCoordinate(Math.max(nextStartRaw, nextEndRaw)), 0, 1);
    const nextWidth =
      updates.width != null ? roundCoordinate(toNumber(updates.width, doorInfo.width)) : doorInfo.width;
    const nextHeight =
      updates.height != null
        ? roundCoordinate(toNumber(updates.height, doorInfo.height))
        : doorInfo.height;

    doorInfo.segmentIndex = nextSegment;
    doorInfo.startRatio = nextStart;
    doorInfo.endRatio = nextEnd;
    doorInfo.width = nextWidth;
    doorInfo.height = nextHeight;

    const doorFields = this.fieldNames.door;
    const doorPath = doorInfo.path;
    const parentPath = doorPath.slice(0, -1);
    const doorIndex = doorPath[doorPath.length - 1]?.index ?? null;
    const doorInstances =
      this.formRenderer.getRepeatableInstances(this.doorSection, parentPath) || [];
    const doorInstance = doorIndex != null ? doorInstances[doorIndex] : null;
    if (doorInstance) {
      doorInstance.values = doorInstance.values || {};
      doorInstance.values[doorFields.segmentIndex] = nextSegment;
      doorInstance.values[doorFields.startRatio] = nextStart;
      doorInstance.values[doorFields.endRatio] = nextEnd;
      doorInstance.values[doorFields.width] = nextWidth;
      doorInstance.values[doorFields.height] = nextHeight;
    }

    this.setFieldValueWithoutState(doorFields.segmentIndex, doorPath, nextSegment);
    this.setFieldValueWithoutState(doorFields.endRatio, doorPath, nextEnd);
    this.setFieldValueWithoutState(doorFields.width, doorPath, nextWidth);
    this.setFieldValueWithoutState(doorFields.height, doorPath, nextHeight);

    this.emitUpdate();

    this.queueFieldUpdate(
      doorFields.startRatio,
      doorPath,
      nextStart,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );
  }

  updateWindow(
    windowId,
    updates = {},
    { triggerEngineUpdate = true } = {}
  ) {
    const windowInfo = this.windows.get(windowId);
    if (!windowInfo || !this.windowSection) {
      return;
    }

    const wallInfo = this.walls.get(windowInfo.wallId);
    const maxSegmentIndex = Math.max(0, (wallInfo?.points || []).length - 2);
    const nextSegment =
      updates.segmentIndex != null
        ? clamp(toInteger(updates.segmentIndex, windowInfo.segmentIndex), 0, maxSegmentIndex)
        : windowInfo.segmentIndex;
    const nextStartRaw =
      updates.startRatio != null
        ? toNumber(updates.startRatio, windowInfo.startRatio)
        : windowInfo.startRatio;
    const nextEndRaw =
      updates.endRatio != null
        ? toNumber(updates.endRatio, windowInfo.endRatio)
        : windowInfo.endRatio;
    const nextStart = clamp(roundCoordinate(Math.min(nextStartRaw, nextEndRaw)), 0, 1);
    const nextEnd = clamp(roundCoordinate(Math.max(nextStartRaw, nextEndRaw)), 0, 1);
    const nextWidth =
      updates.width != null
        ? roundCoordinate(toNumber(updates.width, windowInfo.width))
        : windowInfo.width;
    const nextHeight =
      updates.height != null
        ? roundCoordinate(toNumber(updates.height, windowInfo.height))
        : windowInfo.height;
    const nextDistance =
      updates.distanceFromFloor != null
        ? roundCoordinate(toNumber(updates.distanceFromFloor, windowInfo.distanceFromFloor))
        : windowInfo.distanceFromFloor;

    windowInfo.segmentIndex = nextSegment;
    windowInfo.startRatio = nextStart;
    windowInfo.endRatio = nextEnd;
    windowInfo.width = nextWidth;
    windowInfo.height = nextHeight;
    windowInfo.distanceFromFloor = nextDistance;

    const windowFields = this.fieldNames.window;
    const windowPath = windowInfo.path;
    const parentPath = windowPath.slice(0, -1);
    const windowIndex = windowPath[windowPath.length - 1]?.index ?? null;
    const windowInstances =
      this.formRenderer.getRepeatableInstances(this.windowSection, parentPath) || [];
    const windowInstance = windowIndex != null ? windowInstances[windowIndex] : null;
    if (windowInstance) {
      windowInstance.values = windowInstance.values || {};
      windowInstance.values[windowFields.segmentIndex] = nextSegment;
      windowInstance.values[windowFields.startRatio] = nextStart;
      windowInstance.values[windowFields.endRatio] = nextEnd;
      windowInstance.values[windowFields.width] = nextWidth;
      windowInstance.values[windowFields.height] = nextHeight;
      windowInstance.values[windowFields.distanceFromFloor] = nextDistance;
    }

    this.setFieldValueWithoutState(windowFields.segmentIndex, windowPath, nextSegment);
    this.setFieldValueWithoutState(windowFields.endRatio, windowPath, nextEnd);
    this.setFieldValueWithoutState(windowFields.width, windowPath, nextWidth);
    this.setFieldValueWithoutState(windowFields.height, windowPath, nextHeight);
    this.setFieldValueWithoutState(
      windowFields.distanceFromFloor,
      windowPath,
      nextDistance
    );

    this.emitUpdate();

    this.queueFieldUpdate(
      windowFields.startRatio,
      windowPath,
      nextStart,
      () => {
        this.syncFromState();
        this.emitUpdate();
      },
      { triggerEngineUpdate }
    );
  }

  removeDoor(doorId) {
    if (!this.doorSection) return;
    const doorInfo = this.doors.get(doorId);
    if (!doorInfo) return;
    const parentPath = doorInfo.path.slice(0, -1);
    const indexDescriptor = doorInfo.path[doorInfo.path.length - 1];
    if (!indexDescriptor) return;
    this.formRenderer.removeRepeatableInstance(this.doorSection, parentPath, indexDescriptor.index);
  }

  removeWindow(windowId) {
    if (!this.windowSection) return;
    const windowInfo = this.windows.get(windowId);
    if (!windowInfo) return;
    const parentPath = windowInfo.path.slice(0, -1);
    const indexDescriptor = windowInfo.path[windowInfo.path.length - 1];
    if (!indexDescriptor) return;
    this.formRenderer.removeRepeatableInstance(
      this.windowSection,
      parentPath,
      indexDescriptor.index
    );
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

  focusColumn(columnId) {
    const columnInfo = this.columns.get(columnId);
    if (!columnInfo) return;
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(columnInfo.path);
    }
    const container = this.formRenderer.getRepeatableInstanceContainer(columnInfo.path);
    highlightElement(container);
  }

  focusBeam(beamId) {
    const beamInfo = this.beams.get(beamId);
    if (!beamInfo) return;
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(beamInfo.path);
    }
    const container = this.formRenderer.getRepeatableInstanceContainer(beamInfo.path);
    highlightElement(container);
  }

  focusDoor(doorId) {
    const doorInfo = this.doors.get(doorId);
    if (!doorInfo) return;
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(doorInfo.path);
    }
    const container = this.formRenderer.getRepeatableInstanceContainer(doorInfo.path);
    highlightElement(container);
  }

  focusWindow(windowId) {
    const windowInfo = this.windows.get(windowId);
    if (!windowInfo) return;
    if (
      this.formRenderer &&
      typeof this.formRenderer.ensureRepeatablePathExpanded === 'function'
    ) {
      this.formRenderer.ensureRepeatablePathExpanded(windowInfo.path);
    }
    const container = this.formRenderer.getRepeatableInstanceContainer(windowInfo.path);
    highlightElement(container);
  }

  getSnapshot() {
    const activeRooms = Array.from(this.rooms.values()).filter(
      (room) => room.floorIndex === this.activeFloorIndex
    );
    const activeWalls = Array.from(this.walls.values()).filter(
      (wall) => wall.floorIndex === this.activeFloorIndex
    );
    const activeColumns = Array.from(this.columns.values()).filter(
      (column) => column.floorIndex === this.activeFloorIndex
    );
    const activeBeams = Array.from(this.beams.values()).filter(
      (beam) => beam.floorIndex === this.activeFloorIndex
    );
    const activeDoors = Array.from(this.doors.values()).filter(
      (door) => door.floorIndex === this.activeFloorIndex
    );
    const activeWindows = Array.from(this.windows.values()).filter(
      (window) => window.floorIndex === this.activeFloorIndex
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
        index: room.index,
        vertices: cloneVertices(room.vertices),
        rect: { ...room.rect },
        color: room.color,
        displayLabel: room.displayLabel || (typeof room.index === 'number' ? `R#${room.index + 1}` : null),
      })),
      walls: activeWalls.map((wall) => ({
        id: wall.id,
        roomId: wall.roomId,
        path: wall.path,
        index: wall.index,
        points: cloneVertices(wall.points),
        doors: Array.isArray(wall.doors) ? [...wall.doors] : [],
        windows: Array.isArray(wall.windows) ? [...wall.windows] : [],
        displayLabel: wall.displayLabel || wall.label || null,
      })),
      columns: activeColumns.map((column) => ({
        id: column.id,
        roomId: column.roomId,
        path: column.path,
        index: column.index,
        width: column.width,
        height: column.height,
        vertical: column.vertical,
        centerU: column.centerU,
        centerV: column.centerV,
        wallSegmentIndex: column.wallSegmentIndex,
        wallRatio: column.wallRatio,
        label: column.label,
        displayLabel: column.displayLabel || column.label || null,
      })),
      beams: activeBeams.map((beam) => ({
        id: beam.id,
        roomId: beam.roomId,
        path: beam.path,
        index: beam.index,
        width: beam.width,
        height: beam.height,
        startU: beam.startU,
        startV: beam.startV,
        endU: beam.endU,
        endV: beam.endV,
        wallSegmentIndex: beam.wallSegmentIndex,
        startRatio: beam.startRatio,
        endRatio: beam.endRatio,
        length: beam.length,
        label: beam.label,
        displayLabel: beam.displayLabel || beam.label || null,
      })),
      doors: activeDoors.map((door) => ({
        id: door.id,
        wallId: door.wallId,
        roomId: door.roomId,
        path: door.path,
        segmentIndex: door.segmentIndex,
        startRatio: door.startRatio,
        endRatio: door.endRatio,
        width: door.width,
        height: door.height,
        label: door.label,
        wallReference: door.wallReference,
      })),
      windows: activeWindows.map((window) => ({
        id: window.id,
        wallId: window.wallId,
        roomId: window.roomId,
        path: window.path,
        segmentIndex: window.segmentIndex,
        startRatio: window.startRatio,
        endRatio: window.endRatio,
        width: window.width,
        height: window.height,
        distanceFromFloor: window.distanceFromFloor,
        label: window.label,
        wallReference: window.wallReference,
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
    this.columns.clear();
    this.beams.clear();
    this.doors.clear();
    this.windows.clear();
    this.floors = [];

    if (!this.floorSection || !this.roomSection) {
      this.floorCount = 0;
      return;
    }

    const roomVerticesField = this.fieldNames.roomVertices;
    const wallGeometryField = this.wallSection ? this.fieldNames.wallGeometry : null;
    const wallLabelField = this.wallSection ? this.fieldNames.wallLabel : null;
    const doorFields = this.doorSection ? this.fieldNames.door : null;
    const windowFields = this.windowSection ? this.fieldNames.window : null;

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
          index: roomIndex,
          vertices,
          rect,
          color,
          displayLabel: `R#${roomIndex + 1}`,
        });

        const columnFields = this.columnSection ? this.fieldNames.column : null;
        const beamFields = this.beamSection ? this.fieldNames.beam : null;

        if (this.columnSection && columnFields) {
          const columnInstances =
            this.formRenderer.getRepeatableInstances(this.columnSection, roomPath) || [];
          columnInstances.forEach((columnInstance, columnIndex) => {
            const columnPath = [...roomPath, { key: this.columnKey, index: columnIndex }];
            const columnId =
              columnInstance && columnInstance.id
                ? columnInstance.id
                : this.formRenderer.formatContextPath(columnPath);
            if (!columnInstance.values || typeof columnInstance.values !== 'object') {
              columnInstance.values = {};
            }
            const values = columnInstance.values;
            const width = roundCoordinate(
              toNumber(values[columnFields.width], DEFAULT_COLUMN_WIDTH)
            );
            const height = roundCoordinate(
              toNumber(values[columnFields.height], DEFAULT_COLUMN_WIDTH)
            );
            const vertical = roundCoordinate(
              toNumber(values[columnFields.vertical], DEFAULT_COLUMN_HEIGHT)
            );
            const centerU = clamp(
              roundCoordinate(toNumber(values[columnFields.centerU], 0.5)),
              0,
              1
            );
            const centerV = clamp(
              roundCoordinate(toNumber(values[columnFields.centerV], 0.5)),
              0,
              1
            );
            const wallSegmentIndex = toInteger(values[columnFields.wallSegmentIndex], -1);
            const wallRatio = clamp(
              roundCoordinate(toNumber(values[columnFields.wallRatio], 0)),
              0,
              1
            );
            const labelValue =
              typeof values[columnFields.label] === 'string' ? values[columnFields.label] : '';

            if (values[columnFields.centerU] !== centerU) {
              values[columnFields.centerU] = centerU;
              this.setFieldValueWithoutState(columnFields.centerU, columnPath, centerU);
            }
            if (values[columnFields.centerV] !== centerV) {
              values[columnFields.centerV] = centerV;
              this.setFieldValueWithoutState(columnFields.centerV, columnPath, centerV);
            }
            if (values[columnFields.wallSegmentIndex] !== wallSegmentIndex) {
              values[columnFields.wallSegmentIndex] = wallSegmentIndex;
              this.setFieldValueWithoutState(
                columnFields.wallSegmentIndex,
                columnPath,
                wallSegmentIndex
              );
            }
            if (values[columnFields.wallRatio] !== wallRatio) {
              values[columnFields.wallRatio] = wallRatio;
              this.setFieldValueWithoutState(columnFields.wallRatio, columnPath, wallRatio);
            }

            const displayLabel =
              typeof labelValue === 'string' && labelValue.trim() !== ''
                ? labelValue
                : `C#${columnIndex + 1}`;

            if (
              !values[columnFields.label] ||
              (typeof values[columnFields.label] === 'string' &&
                values[columnFields.label].trim() === '')
            ) {
              values[columnFields.label] = displayLabel;
            }

            this.columns.set(columnId, {
              id: columnId,
              roomId,
              floorIndex,
              path: columnPath,
              index: columnIndex,
              width,
              height,
              vertical,
              centerU,
              centerV,
              wallSegmentIndex,
              wallRatio,
              label: displayLabel,
              displayLabel,
            });
          });
        }

        if (this.beamSection && beamFields) {
          const beamInstances =
            this.formRenderer.getRepeatableInstances(this.beamSection, roomPath) || [];
          beamInstances.forEach((beamInstance, beamIndex) => {
            const beamPath = [...roomPath, { key: this.beamKey, index: beamIndex }];
            const beamId =
              beamInstance && beamInstance.id
                ? beamInstance.id
                : this.formRenderer.formatContextPath(beamPath);
            if (!beamInstance.values || typeof beamInstance.values !== 'object') {
              beamInstance.values = {};
            }
            const values = beamInstance.values;

            const width = roundCoordinate(
              toNumber(values[beamFields.width], DEFAULT_BEAM_WIDTH)
            );
            const height = roundCoordinate(
              toNumber(values[beamFields.height], DEFAULT_BEAM_HEIGHT)
            );
            const startU = clamp(
              roundCoordinate(toNumber(values[beamFields.startU], 0.2)),
              0,
              1
            );
            const startV = clamp(
              roundCoordinate(toNumber(values[beamFields.startV], 0.2)),
              0,
              1
            );
            const endU = clamp(
              roundCoordinate(toNumber(values[beamFields.endU], 0.8)),
              0,
              1
            );
            const endV = clamp(
              roundCoordinate(toNumber(values[beamFields.endV], 0.2)),
              0,
              1
            );
            const wallSegmentIndex = toInteger(values[beamFields.wallSegmentIndex], -1);
            const startRatio = clamp(
              roundCoordinate(toNumber(values[beamFields.startRatio], 0)),
              0,
              1
            );
            const endRatio = clamp(
              roundCoordinate(toNumber(values[beamFields.endRatio], 0)),
              0,
              1
            );
            const labelValue =
              typeof values[beamFields.label] === 'string' ? values[beamFields.label] : '';

            const startPoint = {
              x: rect.x + startU * rect.width,
              y: rect.y + startV * rect.height,
            };
            const endPoint = {
              x: rect.x + endU * rect.width,
              y: rect.y + endV * rect.height,
            };
            const lengthMeters = roundCoordinate(distanceBetweenPoints(startPoint, endPoint));

            if (values[beamFields.startU] !== startU) {
              values[beamFields.startU] = startU;
              this.setFieldValueWithoutState(beamFields.startU, beamPath, startU);
            }
            if (values[beamFields.startV] !== startV) {
              values[beamFields.startV] = startV;
              this.setFieldValueWithoutState(beamFields.startV, beamPath, startV);
            }
            if (values[beamFields.endU] !== endU) {
              values[beamFields.endU] = endU;
              this.setFieldValueWithoutState(beamFields.endU, beamPath, endU);
            }
            if (values[beamFields.endV] !== endV) {
              values[beamFields.endV] = endV;
              this.setFieldValueWithoutState(beamFields.endV, beamPath, endV);
            }
            if (values[beamFields.wallSegmentIndex] !== wallSegmentIndex) {
              values[beamFields.wallSegmentIndex] = wallSegmentIndex;
              this.setFieldValueWithoutState(
                beamFields.wallSegmentIndex,
                beamPath,
                wallSegmentIndex
              );
            }
            if (values[beamFields.startRatio] !== startRatio) {
              values[beamFields.startRatio] = startRatio;
              this.setFieldValueWithoutState(beamFields.startRatio, beamPath, startRatio);
            }
            if (values[beamFields.endRatio] !== endRatio) {
              values[beamFields.endRatio] = endRatio;
              this.setFieldValueWithoutState(beamFields.endRatio, beamPath, endRatio);
            }
            if (values[beamFields.length] !== lengthMeters) {
              values[beamFields.length] = lengthMeters;
              this.setFieldValueWithoutState(beamFields.length, beamPath, lengthMeters);
            }

            const displayLabel =
              typeof labelValue === 'string' && labelValue.trim() !== ''
                ? labelValue
                : `B#${beamIndex + 1}`;

            if (
              !values[beamFields.label] ||
              (typeof values[beamFields.label] === 'string' &&
                values[beamFields.label].trim() === '')
            ) {
              values[beamFields.label] = displayLabel;
            }

            this.beams.set(beamId, {
              id: beamId,
              roomId,
              floorIndex,
              path: beamPath,
              index: beamIndex,
              width,
              height,
              startU,
              startV,
              endU,
              endV,
              wallSegmentIndex,
              startRatio,
              endRatio,
              length: lengthMeters,
              label: displayLabel,
              displayLabel,
            });
          });
        }

        if (!this.wallSection || !wallGeometryField) {
          return;
        }

        const wallInstances = this.formRenderer.getRepeatableInstances(this.wallSection, roomPath) || [];

        wallInstances.forEach((wallInstance, wallIndex) => {
          const wallPath = [...roomPath, { key: this.wallKey, index: wallIndex }];
          const points = roundVertices(parsePoints(wallInstance?.values?.[wallGeometryField]));
          const wallId =
            wallInstance && wallInstance.id
              ? wallInstance.id
              : this.formRenderer.formatContextPath(wallPath);

          const wallLabelValue =
            wallLabelField && wallInstance?.values
              ? wallInstance.values[wallLabelField]
              : '';
          const displayLabel =
            typeof wallLabelValue === 'string' && wallLabelValue.trim() !== ''
              ? wallLabelValue
              : `W#${wallIndex + 1}`;

          const wallEntry = {
            id: wallId,
            roomId,
            floorIndex,
            path: wallPath,
            index: wallIndex,
            points,
            doors: [],
            windows: [],
            label: displayLabel,
            displayLabel,
          };

          this.walls.set(wallId, wallEntry);

          if (this.doorSection && doorFields) {
            const doorInstances =
              this.formRenderer.getRepeatableInstances(this.doorSection, wallPath) || [];
            doorInstances.forEach((doorInstance, doorIndex) => {
              const doorPath = [...wallPath, { key: this.doorKey, index: doorIndex }];
              const doorId =
                doorInstance && doorInstance.id
                  ? doorInstance.id
                  : this.formRenderer.formatContextPath(doorPath);
              if (!doorInstance.values || typeof doorInstance.values !== 'object') {
                doorInstance.values = {};
              }
              const doorValues = doorInstance.values;
              const maxSegmentIndex = Math.max(0, points.length - 2);
              const rawSegmentIndex = toInteger(doorValues[doorFields.segmentIndex], 0);
              const segmentIndex = clamp(rawSegmentIndex, 0, maxSegmentIndex);
              const rawStart = toNumber(doorValues[doorFields.startRatio], 0);
              const rawEnd = toNumber(doorValues[doorFields.endRatio], rawStart);
              const startRatio = clamp(roundCoordinate(Math.min(rawStart, rawEnd)), 0, 1);
              const endRatio = clamp(roundCoordinate(Math.max(rawStart, rawEnd)), 0, 1);
              const width = roundCoordinate(
                toNumber(doorValues[doorFields.width], DEFAULT_DOOR_WIDTH)
              );
              const height = roundCoordinate(
                toNumber(doorValues[doorFields.height], DEFAULT_DOOR_HEIGHT)
              );
              const labelValue =
                typeof doorValues[doorFields.label] === 'string'
                  ? doorValues[doorFields.label]
                  : '';
              let wallReference =
                typeof doorValues[doorFields.wallReference] === 'string'
                  ? doorValues[doorFields.wallReference]
                  : '';

              if (segmentIndex !== rawSegmentIndex) {
                doorValues[doorFields.segmentIndex] = segmentIndex;
                this.setFieldValueWithoutState(doorFields.segmentIndex, doorPath, segmentIndex);
              }
              if (startRatio !== rawStart) {
                doorValues[doorFields.startRatio] = startRatio;
                this.setFieldValueWithoutState(doorFields.startRatio, doorPath, startRatio);
              }
              if (endRatio !== rawEnd) {
                doorValues[doorFields.endRatio] = endRatio;
                this.setFieldValueWithoutState(doorFields.endRatio, doorPath, endRatio);
              }
              if (wallReference !== wallId) {
                wallReference = wallId;
                doorValues[doorFields.wallReference] = wallReference;
                this.setFieldValueWithoutState(doorFields.wallReference, doorPath, wallReference);
              }

              const doorRecord = {
                id: doorId,
                wallId,
                roomId,
                floorIndex,
                path: doorPath,
                segmentIndex,
                startRatio,
                endRatio,
                width,
                height,
                label: labelValue,
                wallReference,
              };

              wallEntry.doors.push(doorId);
              this.doors.set(doorId, doorRecord);
            });
          }

          if (this.windowSection && windowFields) {
            const windowInstances =
              this.formRenderer.getRepeatableInstances(this.windowSection, wallPath) || [];
            windowInstances.forEach((windowInstance, windowIndex) => {
              const windowPath = [...wallPath, { key: this.windowKey, index: windowIndex }];
              const windowId =
                windowInstance && windowInstance.id
                  ? windowInstance.id
                  : this.formRenderer.formatContextPath(windowPath);
              if (!windowInstance.values || typeof windowInstance.values !== 'object') {
                windowInstance.values = {};
              }
              const windowValues = windowInstance.values;
              const maxSegmentIndex = Math.max(0, points.length - 2);
              const rawSegmentIndex = toInteger(windowValues[windowFields.segmentIndex], 0);
              const segmentIndex = clamp(rawSegmentIndex, 0, maxSegmentIndex);
              const rawStart = toNumber(windowValues[windowFields.startRatio], 0);
              const rawEnd = toNumber(windowValues[windowFields.endRatio], rawStart);
              const startRatio = clamp(roundCoordinate(Math.min(rawStart, rawEnd)), 0, 1);
              const endRatio = clamp(roundCoordinate(Math.max(rawStart, rawEnd)), 0, 1);
              const width = roundCoordinate(
                toNumber(windowValues[windowFields.width], DEFAULT_WINDOW_WIDTH)
              );
              const height = roundCoordinate(
                toNumber(windowValues[windowFields.height], DEFAULT_WINDOW_HEIGHT)
              );
              const distanceFromFloor = roundCoordinate(
                toNumber(
                  windowValues[windowFields.distanceFromFloor],
                  DEFAULT_WINDOW_SILL_HEIGHT
                )
              );
              const labelValue =
                typeof windowValues[windowFields.label] === 'string'
                  ? windowValues[windowFields.label]
                  : '';
              let wallReference =
                typeof windowValues[windowFields.wallReference] === 'string'
                  ? windowValues[windowFields.wallReference]
                  : '';

              if (segmentIndex !== rawSegmentIndex) {
                windowValues[windowFields.segmentIndex] = segmentIndex;
                this.setFieldValueWithoutState(windowFields.segmentIndex, windowPath, segmentIndex);
              }
              if (startRatio !== rawStart) {
                windowValues[windowFields.startRatio] = startRatio;
                this.setFieldValueWithoutState(windowFields.startRatio, windowPath, startRatio);
              }
              if (endRatio !== rawEnd) {
                windowValues[windowFields.endRatio] = endRatio;
                this.setFieldValueWithoutState(windowFields.endRatio, windowPath, endRatio);
              }
              if (wallReference !== wallId) {
                wallReference = wallId;
                windowValues[windowFields.wallReference] = wallReference;
                this.setFieldValueWithoutState(
                  windowFields.wallReference,
                  windowPath,
                  wallReference
                );
              }

              const windowRecord = {
                id: windowId,
                wallId,
                roomId,
                floorIndex,
                path: windowPath,
                segmentIndex,
                startRatio,
                endRatio,
                width,
                height,
                distanceFromFloor,
                label: labelValue,
                wallReference,
              };

              wallEntry.windows.push(windowId);
              this.windows.set(windowId, windowRecord);
            });
          }
        });
      }); // end roomInstances.forEach
    }); // end floorInstances.forEach

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

  autoPopulateColumn(instancePath) {
    if (!this.columnSection) return;
    const columnFields = this.fieldNames.column;
    if (!columnFields) return;
    const roomPath = instancePath.slice(0, -1);
    const room = this.findRoomByPath(roomPath);
    if (!room || !room.rect) return;

    const columnInstances = this.formRenderer.getRepeatableInstances(this.columnSection, roomPath) || [];
    const instanceIndex = instancePath[instancePath.length - 1]?.index ?? columnInstances.length - 1;
    const normalizedOffset = (instanceIndex % 3) / 3;
    const centerU = roundCoordinate(clamp(0.25 + normalizedOffset * 0.5, 0.1, 0.9));
    const centerV = roundCoordinate(clamp(0.3 + ((instanceIndex % 2) * 0.3), 0.1, 0.9));
    const label = `C#${columnInstances.length}`;

    this.setFieldValueWithoutState(columnFields.label, instancePath, label);
    this.setFieldValueWithoutState(columnFields.width, instancePath, DEFAULT_COLUMN_WIDTH);
    this.setFieldValueWithoutState(columnFields.height, instancePath, DEFAULT_COLUMN_WIDTH);
    this.setFieldValueWithoutState(columnFields.vertical, instancePath, DEFAULT_COLUMN_HEIGHT);
    this.setFieldValueWithoutState(columnFields.centerU, instancePath, centerU);
    this.setFieldValueWithoutState(columnFields.centerV, instancePath, centerV);
    this.setFieldValueWithoutState(columnFields.wallSegmentIndex, instancePath, -1);
    this.setFieldValueWithoutState(columnFields.wallRatio, instancePath, 0);

    if (this.formStateManager && typeof this.formStateManager.updateFormState === 'function') {
      this.formStateManager.updateFormState();
    }
    this.syncFromState();
    this.emitUpdate();
  }

  autoPopulateBeam(instancePath) {
    if (!this.beamSection) return;
    const beamFields = this.fieldNames.beam;
    if (!beamFields) return;
    const roomPath = instancePath.slice(0, -1);
    const room = this.findRoomByPath(roomPath);
    if (!room || !room.rect) return;

    const beamInstances = this.formRenderer.getRepeatableInstances(this.beamSection, roomPath) || [];
    const instanceIndex = instancePath[instancePath.length - 1]?.index ?? beamInstances.length - 1;
    const baseY = 0.3 + (instanceIndex % 3) * 0.15;
    const startU = roundCoordinate(0.2);
    const endU = roundCoordinate(0.8);
    const startV = roundCoordinate(clamp(baseY, 0.1, 0.9));
    const endV = startV;
    const label = `B#${beamInstances.length}`;

    const startPoint = {
      x: room.rect.x + startU * room.rect.width,
      y: room.rect.y + startV * room.rect.height,
    };
    const endPoint = {
      x: room.rect.x + endU * room.rect.width,
      y: room.rect.y + endV * room.rect.height,
    };
    const lengthMeters = roundCoordinate(distanceBetweenPoints(startPoint, endPoint));

    this.setFieldValueWithoutState(beamFields.label, instancePath, label);
    this.setFieldValueWithoutState(beamFields.width, instancePath, DEFAULT_BEAM_WIDTH);
    this.setFieldValueWithoutState(beamFields.height, instancePath, DEFAULT_BEAM_HEIGHT);
    this.setFieldValueWithoutState(beamFields.startU, instancePath, startU);
    this.setFieldValueWithoutState(beamFields.startV, instancePath, startV);
    this.setFieldValueWithoutState(beamFields.endU, instancePath, endU);
    this.setFieldValueWithoutState(beamFields.endV, instancePath, endV);
    this.setFieldValueWithoutState(beamFields.wallSegmentIndex, instancePath, -1);
    this.setFieldValueWithoutState(beamFields.startRatio, instancePath, 0);
    this.setFieldValueWithoutState(beamFields.endRatio, instancePath, 0);
    this.setFieldValueWithoutState(beamFields.length, instancePath, lengthMeters);

    if (this.formStateManager && typeof this.formStateManager.updateFormState === 'function') {
      this.formStateManager.updateFormState();
    }
    this.syncFromState();
    this.emitUpdate();
  }

  autoPopulateDoor(instancePath) {
    if (!this.doorSection) return;
    if (!Array.isArray(instancePath) || instancePath.length === 0) return;
    const doorFields = this.fieldNames.door;
    if (!doorFields) return;

    const wallPath = instancePath.slice(0, -1);
    const wall = this.findWallByPath(wallPath);
    if (!wall) return;

    const siblings = this.formRenderer.getRepeatableInstances(this.doorSection, wallPath) || [];
    const defaultLabel = `D#${siblings.length}`;
    const segmentCap = Math.max(0, (wall.points || []).length - 2);
    const defaultSegment = Math.max(0, Math.min(segmentCap, Math.floor(segmentCap / 2)));
    const defaultStart = 0.35;
    const defaultEnd = 0.65;

    this.setFieldValueWithoutState(doorFields.segmentIndex, instancePath, defaultSegment);
    this.setFieldValueWithoutState(doorFields.startRatio, instancePath, defaultStart);
    this.setFieldValueWithoutState(doorFields.endRatio, instancePath, defaultEnd);
    this.setFieldValueWithoutState(doorFields.width, instancePath, DEFAULT_DOOR_WIDTH);
    this.setFieldValueWithoutState(doorFields.height, instancePath, DEFAULT_DOOR_HEIGHT);
    this.setFieldValueWithoutState(doorFields.label, instancePath, defaultLabel);
    this.setFieldValueWithoutState(doorFields.wallReference, instancePath, wall.id);

    if (this.formStateManager && typeof this.formStateManager.updateFormState === 'function') {
      this.formStateManager.updateFormState();
    }
    this.syncFromState();
    this.emitUpdate();
  }

  autoPopulateWindow(instancePath) {
    if (!this.windowSection) return;
    if (!Array.isArray(instancePath) || instancePath.length === 0) return;
    const windowFields = this.fieldNames.window;
    if (!windowFields) return;

    const wallPath = instancePath.slice(0, -1);
    const wall = this.findWallByPath(wallPath);
    if (!wall) return;

    const siblings = this.formRenderer.getRepeatableInstances(this.windowSection, wallPath) || [];
    const defaultLabel = `W#${siblings.length}`;
    const segmentCap = Math.max(0, (wall.points || []).length - 2);
    const defaultSegment = Math.max(0, Math.min(segmentCap, Math.floor(segmentCap / 2)));
    const defaultStart = 0.35;
    const defaultEnd = 0.65;

    this.setFieldValueWithoutState(windowFields.segmentIndex, instancePath, defaultSegment);
    this.setFieldValueWithoutState(windowFields.startRatio, instancePath, defaultStart);
    this.setFieldValueWithoutState(windowFields.endRatio, instancePath, defaultEnd);
    this.setFieldValueWithoutState(windowFields.width, instancePath, DEFAULT_WINDOW_WIDTH);
    this.setFieldValueWithoutState(windowFields.height, instancePath, DEFAULT_WINDOW_HEIGHT);
    this.setFieldValueWithoutState(
      windowFields.distanceFromFloor,
      instancePath,
      DEFAULT_WINDOW_SILL_HEIGHT
    );
    this.setFieldValueWithoutState(windowFields.label, instancePath, defaultLabel);
    this.setFieldValueWithoutState(windowFields.wallReference, instancePath, wall.id);

    if (this.formStateManager && typeof this.formStateManager.updateFormState === 'function') {
      this.formStateManager.updateFormState();
    }
    this.syncFromState();
    this.emitUpdate();
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

  findDoorByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const door of this.doors.values()) {
      if (this.formRenderer.formatContextPath(door.path) === key) {
        return door;
      }
    }
    return null;
  }

  findWindowByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const window of this.windows.values()) {
      if (this.formRenderer.formatContextPath(window.path) === key) {
        return window;
      }
    }
    return null;
  }

  findColumnByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const column of this.columns.values()) {
      if (this.formRenderer.formatContextPath(column.path) === key) {
        return column;
      }
    }
    return null;
  }

  findBeamByPath(instancePath) {
    const key = this.formRenderer.formatContextPath(instancePath);
    for (const beam of this.beams.values()) {
      if (this.formRenderer.formatContextPath(beam.path) === key) {
        return beam;
      }
    }
    return null;
  }

}
