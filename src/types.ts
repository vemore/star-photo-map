export interface Star {
  hip: number;
  ra: number;   // degrees [0, 360)
  dec: number;  // degrees [-90, 90]
  mag: number;
  bv: number;
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  desig?: string;
}

export interface ConstellationLine {
  id: string;
  segments: [number, number][][];
}

export interface ConstellationInfo {
  id: string;
  name: string;
  nameFr: string;
  ra: number;
  dec: number;
}

export interface PhotoCorrespondence {
  pointIndex: number;
  photoX: number;
  photoY: number;
  starHip: number;
  starName: string;
}

export interface Photo {
  id: string;
  filename: string;
  originalName: string;
  width: number;
  height: number;
  createdAt: string;
  correspondences: PhotoCorrespondence[];
}

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewState {
  centerX: number;
  centerY: number;
  scale: number;
  width: number;
  height: number;
}

export interface DetectedSpot {
  x: number;           // pixel X (in the downscaled image)
  y: number;           // pixel Y
  brightness: number;  // sum of intensities in the component
  size: number;        // number of pixels
}

export interface StarDetectionResult {
  spots: DetectedSpot[];
  imageWidth: number;
  imageHeight: number;
  scaleFromOriginal: number; // ratio analysed size / original size
}

export interface PlateSolveResult {
  success: boolean;
  correspondences?: PhotoCorrespondence[];
  error?: string;
}

export interface AstrometrySolveStatus {
  jobId: string;
  status: 'pending' | 'solving' | 'solved' | 'failed' | 'timeout';
  correspondences?: PhotoCorrespondence[];
  error?: string;
}
