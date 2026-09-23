<template>
  <section class="assets mb-4">
    <h2 v-if="displayTitle">{{ displayTitle }}</h2>
    <b-accordion>
      <template v-for="block in blocks" :key="block.key">
        <Asset
          v-if="block.kind === 'asset'"
          :asset="block.asset" :expand="expand"
          :definition="definition" :shown="shownKeys.includes(block.asset.getKey())"
          @show="show"
        />
        <AssetViewerItem
          v-else
          :viewer="block.viewer" :asset="block.asset" :expand="block.expand"
          :shown="shownKeys.includes(block.asset.getKey())"
          @show="show"
        />
      </template>
    </b-accordion>
  </section>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import { BAccordion } from 'bootstrap-vue-next';
import { getViewersForAsset, viewerOrder } from '../oie/assetViewers.js';

export default {
  name: 'Assets',
  components: {
    Asset: defineAsyncComponent(() => import('./Asset.vue')),
    AssetViewerItem: defineAsyncComponent(() => import('../oie/AssetViewerItem.vue')),
    BAccordion
  },
  props: {
    assets: {
      type: Array,
      required: true
    },
    shown: {
      type: Array,
      default: () => ([])
    },
    definition: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: null
    },
    autoExpand: {
      type: Boolean,
      default: false
    }
  },
  emits: ['showAsset'],
  computed: {
    shownKeys() {
      return this.shown
        .filter(asset => asset.isAsset)
        .map(asset => asset.getKey());
    },
    displayTitle() {
      if (this.title === null) {
        let langKey = this.definition ? 'assets.inItems' : 'stacAssets';
        return this.$t(langKey, this.assets.length);
      }
      else {
        return this.title;
      }
    },
    expand() {
      if (this.definition) {
        return false; // Don't expand assets for Item Asset Definitions
      }
      else if (this.assets.length === 1 && this.autoExpand) {
        return true; // Expand asset if it's the only asset available and it is in an Item
      }
      return null; // Let asset decide (e.g. depending on roles)
    },
    // Asset blocks and append-mode viewer blocks in a single list, sorted by
    // each viewer's optional `order` (see assetViewers.js). Ties keep the
    // natural assets-then-viewers order.
    blocks() {
      const blocks = [];
      for (const asset of this.assets) {
        const key = typeof asset.getKey === 'function' ? asset.getKey() : '';
        blocks.push({
          kind: 'asset', asset, order: this.assetOrder(asset),
          key: `asset-${key}`, seq: blocks.length
        });
        if (this.definition) {
          continue;
        }
        for (const viewer of getViewersForAsset(asset, 'append')) {
          blocks.push({
            kind: 'viewer', viewer, asset, expand: viewer.expand === true,
            order: viewerOrder(viewer), key: `append-${viewer.id}-${key}`, seq: blocks.length
          });
        }
      }
      return blocks.sort((a, b) => a.order - b.order || a.seq - b.seq);
    }
  },
  methods: {
    // An asset block inherits its in-place viewer's order, if any, so it can be
    // sorted together with the append viewers.
    assetOrder(asset) {
      if (this.definition) {
        return 0;
      }
      const viewer = getViewersForAsset(asset, 'inplace')[0];
      return viewer ? viewerOrder(viewer) : 0;
    },
    show() {
      this.$emit('showAsset', ...arguments);
    }
  }
};
</script>
