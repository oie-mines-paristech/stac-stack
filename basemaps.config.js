import { Collection } from './src/models/stac';
import { STAC } from 'stac-js'

// For documentation see https://github.com/radiantearth/stac-browser/blob/main/docs/basemaps.md

const BASEMAPS = {
  earth: [
    {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      is: 'XYZ',
      title: 'OpenStreetMap',
      attributions: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors.',
      projection: "EPSG:3857"
    }
  ],
};

/**
 * 
 * @param {Object} stac The STAC object
 * @param {Object} i18n Vue I18N object
 * @returns {Array.<BasemapOptions>}
 */
export default function configureBasemap(stac, i18n) {
  let targets = ['earth'];

  let layers = [];
  for (const target of targets) {
    const maps = BASEMAPS[target.toLowerCase()];
    if (!Array.isArray(maps)) {
      continue;
    }
    layers = layers.concat(maps);
  }
  return layers;
};
