<template>
  <section class="assets mb-4">
    <h2 v-if="displayTitle">{{ displayTitle }}</h2>
    <b-accordion>
      <Asset
        v-for="asset in assets" :asset="asset" :expand="expand"
        :definition="definition" :shown="shownKeys.includes(asset.getKey())"
        :key="asset.getKey()" @show="show"
      />
      <AssetViewerItem
        v-for="item in viewerItems" :key="item.key"
        :viewer="item.viewer" :asset="item.asset" :expand="item.expand"
      />
    </b-accordion>
  </section>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import { BAccordion } from 'bootstrap-vue-next';
import { getViewersForAsset } from '../oie/assetViewers.js';

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
    viewerItems() {
      if (this.definition) {
        return [];
      }
      const items = [];
      for (const asset of this.assets) {
        for (const viewer of getViewersForAsset(asset, 'append')) {
          const key = typeof asset.getKey === 'function' ? asset.getKey() : '';
          items.push({ viewer, asset, key: `append-${viewer.id}-${key}`, expand: viewer.expand === true });
        }
      }
      return items;
    }
  },
  methods: {
    show() {
      this.$emit('showAsset', ...arguments);
    }
  }
};
</script>
