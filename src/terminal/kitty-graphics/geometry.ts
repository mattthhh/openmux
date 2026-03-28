import type { KittyGraphicsImageInfo, KittyGraphicsPlacement } from '../emulator-interface';
import type { CellMetrics, ClipRect, PaneState, PlacementRender } from './types';

export function computePlacementRender(
  pane: PaneState,
  placement: KittyGraphicsPlacement,
  image: KittyGraphicsImageInfo,
  metrics: CellMetrics
): PlacementRender | null {
  const { cellWidth, cellHeight } = metrics;
  const includeColumns = placement.columns > 0;
  const includeRows = placement.rows > 0;

  // screenY is expressed in the wrapped emulator's absolute line space:
  //   0 = oldest line in total scrollback (archive + live)
  // Row-fetching uses:
  //   absoluteY = scrollbackLength - viewportOffset + viewportRow
  // therefore:
  //   viewportRow = absoluteY - scrollbackLength + viewportOffset
  const viewportRow = placement.screenY - pane.scrollbackLength + pane.viewportOffset;
  const viewportCol = placement.screenX;

  const srcWidth = placement.sourceWidth > 0 ? placement.sourceWidth : image.width;
  const srcHeight = placement.sourceHeight > 0 ? placement.sourceHeight : image.height;
  if (srcWidth <= 0 || srcHeight <= 0) return null;

  const dest = computeDestSize(placement, srcWidth, srcHeight, cellWidth, cellHeight);
  if (dest.width <= 0 || dest.height <= 0) return null;

  const gridCols = Math.ceil((dest.width + placement.xOffset) / cellWidth);
  const gridRows = Math.ceil((dest.height + placement.yOffset) / cellHeight);
  if (gridCols <= 0 || gridRows <= 0) return null;

  const left = viewportCol;
  const top = viewportRow;
  const right = viewportCol + gridCols;
  const bottom = viewportRow + gridRows;

  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(pane.cols, right);
  const visibleBottom = Math.min(pane.rows, bottom);

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  const visibleLeftPx = (visibleLeft - left) * cellWidth;
  const visibleTopPx = (visibleTop - top) * cellHeight;
  const visibleRightPx = (visibleRight - left) * cellWidth;
  const visibleBottomPx = (visibleBottom - top) * cellHeight;

  const imageLeftPx = placement.xOffset;
  const imageTopPx = placement.yOffset;
  const imageRightPx = placement.xOffset + dest.width;
  const imageBottomPx = placement.yOffset + dest.height;

  const cropLeftPx = Math.max(0, visibleLeftPx - imageLeftPx);
  const cropTopPx = Math.max(0, visibleTopPx - imageTopPx);
  const cropRightPx = Math.max(0, imageRightPx - visibleRightPx);
  const cropBottomPx = Math.max(0, imageBottomPx - visibleBottomPx);

  const croppedWidth = dest.width - cropLeftPx - cropRightPx;
  const croppedHeight = dest.height - cropTopPx - cropBottomPx;
  if (croppedWidth <= 0 || croppedHeight <= 0) return null;

  const scaleX = srcWidth / dest.width;
  const scaleY = srcHeight / dest.height;
  const cropLeftSrc = Math.round(cropLeftPx * scaleX);
  const cropTopSrc = Math.round(cropTopPx * scaleY);
  const cropRightSrc = Math.round(cropRightPx * scaleX);
  const cropBottomSrc = Math.round(cropBottomPx * scaleY);

  const sourceX = placement.sourceX + cropLeftSrc;
  const sourceY = placement.sourceY + cropTopSrc;
  const sourceWidth = srcWidth - cropLeftSrc - cropRightSrc;
  const sourceHeight = srcHeight - cropTopSrc - cropBottomSrc;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const xOffset = Math.max(0, imageLeftPx - visibleLeftPx);
  const yOffset = Math.max(0, imageTopPx - visibleTopPx);

  const columns = Math.max(1, visibleRight - visibleLeft);
  const rows = Math.max(1, visibleBottom - visibleTop);

  return {
    key: buildPlacementKey(placement),
    imageId: placement.imageId,
    hostImageId: 0,
    hostPlacementId: 0,
    globalRow: pane.offsetY + visibleTop,
    globalCol: pane.offsetX + visibleLeft,
    columns,
    rows,
    includeColumns,
    includeRows,
    xOffset,
    yOffset,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    z: placement.z,
  };
}

export function applyClipRects(
  render: PlacementRender,
  metrics: CellMetrics,
  clipRects: ClipRect[]
): PlacementRender[] {
  if (clipRects.length === 0) return [render];

  const baseRect: ClipRect = {
    x: render.globalCol,
    y: render.globalRow,
    width: render.columns,
    height: render.rows,
  };

  let allowed: ClipRect[] = [baseRect];
  for (const clip of clipRects) {
    const next: ClipRect[] = [];
    for (const rect of allowed) {
      next.push(...subtractRect(rect, clip));
    }
    allowed = next;
    if (allowed.length === 0) return [];
  }

  if (allowed.length === 1 && rectEquals(allowed[0], baseRect)) {
    return [render];
  }

  allowed.sort((a, b) => a.y - b.y || a.x - b.x);

  const pieces: PlacementRender[] = [];
  allowed.forEach((rect, index) => {
    const slice = slicePlacement(render, rect, metrics);
    if (!slice) return;
    slice.key = `${render.key}:${index}`;
    pieces.push(slice);
  });

  return pieces;
}

export function buildPlacementKey(placement: KittyGraphicsPlacement): string {
  return `${placement.imageId}:${placement.placementTag}:${placement.placementId}`;
}

function computeDestSize(
  placement: KittyGraphicsPlacement,
  srcWidth: number,
  srcHeight: number,
  cellWidth: number,
  cellHeight: number
): { width: number; height: number } {
  if (placement.columns > 0 && placement.rows > 0) {
    return {
      width: placement.columns * cellWidth,
      height: placement.rows * cellHeight,
    };
  }

  if (placement.columns > 0) {
    const width = placement.columns * cellWidth;
    const height = Math.round((width * srcHeight) / Math.max(srcWidth, 1));
    return { width, height };
  }

  if (placement.rows > 0) {
    const height = placement.rows * cellHeight;
    const width = Math.round((height * srcWidth) / Math.max(srcHeight, 1));
    return { width, height };
  }

  return { width: srcWidth, height: srcHeight };
}

function slicePlacement(
  render: PlacementRender,
  rect: ClipRect,
  metrics: CellMetrics
): PlacementRender | null {
  const { cellWidth, cellHeight } = metrics;
  const gridLeft = render.globalCol;
  const gridTop = render.globalRow;
  const gridRight = gridLeft + render.columns;
  const gridBottom = gridTop + render.rows;
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;

  if (rect.width <= 0 || rect.height <= 0) return null;
  if (rect.x < gridLeft || rect.y < gridTop || rectRight > gridRight || rectBottom > gridBottom)
    return null;

  const trimLeftCells = rect.x - gridLeft;
  const trimTopCells = rect.y - gridTop;
  const trimRightCells = gridRight - rectRight;
  const trimBottomCells = gridBottom - rectBottom;

  const trimLeftPx = trimLeftCells * cellWidth;
  const trimTopPx = trimTopCells * cellHeight;
  const trimRightPx = trimRightCells * cellWidth;
  const trimBottomPx = trimBottomCells * cellHeight;

  const gridWidthPx = render.columns * cellWidth;
  const gridHeightPx = render.rows * cellHeight;
  const imageWidthPx = gridWidthPx - render.xOffset;
  const imageHeightPx = gridHeightPx - render.yOffset;
  if (imageWidthPx <= 0 || imageHeightPx <= 0) return null;

  const scaleX = render.sourceWidth / imageWidthPx;
  const scaleY = render.sourceHeight / imageHeightPx;

  const trimLeftSrc = Math.round(Math.max(0, trimLeftPx - render.xOffset) * scaleX);
  const trimTopSrc = Math.round(Math.max(0, trimTopPx - render.yOffset) * scaleY);
  const trimRightSrc = Math.round(trimRightPx * scaleX);
  const trimBottomSrc = Math.round(trimBottomPx * scaleY);

  const sourceWidth = render.sourceWidth - trimLeftSrc - trimRightSrc;
  const sourceHeight = render.sourceHeight - trimTopSrc - trimBottomSrc;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  return {
    ...render,
    globalCol: rect.x,
    globalRow: rect.y,
    columns: rect.width,
    rows: rect.height,
    xOffset: Math.max(0, render.xOffset - trimLeftPx),
    yOffset: Math.max(0, render.yOffset - trimTopPx),
    sourceX: render.sourceX + trimLeftSrc,
    sourceY: render.sourceY + trimTopSrc,
    sourceWidth,
    sourceHeight,
  };
}

function subtractRect(rect: ClipRect, clip: ClipRect): ClipRect[] {
  const intersection = intersectRect(rect, clip);
  if (!intersection) return [rect];

  const rects: ClipRect[] = [];
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const interRight = intersection.x + intersection.width;
  const interBottom = intersection.y + intersection.height;

  if (rect.y < intersection.y) {
    rects.push({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: intersection.y - rect.y,
    });
  }

  if (interBottom < rectBottom) {
    rects.push({
      x: rect.x,
      y: interBottom,
      width: rect.width,
      height: rectBottom - interBottom,
    });
  }

  if (rect.x < intersection.x) {
    rects.push({
      x: rect.x,
      y: intersection.y,
      width: intersection.x - rect.x,
      height: intersection.height,
    });
  }

  if (interRight < rectRight) {
    rects.push({
      x: interRight,
      y: intersection.y,
      width: rectRight - interRight,
      height: intersection.height,
    });
  }

  return rects;
}

function intersectRect(a: ClipRect, b: ClipRect): ClipRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectEquals(a: ClipRect, b: ClipRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
