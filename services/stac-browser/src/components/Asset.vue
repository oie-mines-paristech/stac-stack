<template>
  <b-accordion-item
    :id="uid"
    v-model="expanded"
    class="asset"
    body-class="asset-body"
    @update:model-value="collapseToggled"
  >
    <template #title>
      <span class="start">
        <span class="chevron" aria-hidden="true">
          <b-icon-chevron-down v-if="expanded" />
          <b-icon-chevron-right v-else />
        </span>
        <img
          v-if="isImageViewerIcon"
          :src="viewerIcon"
          alt=""
          class="asset-viewer-icon img-fluid"
        >
        <span v-else-if="viewerIcon" class="asset-viewer-icon">{{ viewerIcon }}</span>
        <span class="title" :title="title">{{ title }}</span>
      </span>
      <AssetBadges :asset="asset" :shown="shown" :extra-roles="viewerRoles" />
    </template>
   
    <template v-if="hasAlternatives">
      <b-card no-body class="border-0 rounded-0">
        <b-tabs v-model="activeTab" lazy card>
          <b-tab :id="mainTabId" :title="asset['alternate:name'] || $t('assets.alternate.main')" no-body>
            <AssetAlternative :asset="asset" :shown="shown" :definition="definition" @show="show" />
          </b-tab>
          <b-tab v-for="(altAsset, key) in alternatives" :id="getAlternativeTabId(key)" :title="altAsset['alternate:name'] || key" :key="key" no-body>
            <AssetAlternative :asset="altAsset" :shown="shown" :definition="definition" @show="show" />
          </b-tab>
        </b-tabs>
      </b-card>
    </template>
    <AssetAlternative v-else :asset="asset" :shown="shown" :definition="definition" @show="show" />
  </b-accordion-item>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import { mapState } from 'vuex';
import { isObject, size } from 'stac-js/src/utils.js';
import { BCard, BTab, BTabs, BAccordionItem } from 'bootstrap-vue-next';
import AssetBadges from './AssetBadges.vue';
import { getViewersForAsset, isImageIcon } from '../oie/assetViewers.js';

export default {
  name: 'Asset',
  components: {
    AssetAlternative: defineAsyncComponent(() => import('./AssetAlternative.vue')),
    AssetBadges,
    BCard,
    BTab,
    BTabs,
    BAccordionItem
  },
  props: {
    asset: {
      type: Object,
      required: true
    },
    definition: {
      type: Boolean,
      default: false
    },
    expand: {
      type: Boolean,
      default: null
    },
    shown: {
      type: Boolean,
      default: false
    }
  },
  emits: ['show'],
  data() {
    return {
      expanded: false,
      activeTab: null
    };
  },
  computed: {
    ...mapState(['stateQueryParameters', 'preferredAssets']),
    type() {
      return this.definition ? 'itemdef' : 'asset';
    },
    uid() {
      return `${this.type}-${this.asset.getKey().toLowerCase().replace(/[^\w]/g, '-')}`;
    },
    title() {
      return this.asset.title || this.asset.getKey();
    },
    // First in-place viewer for this asset. Its icon is shown next to the block
    // title (same placement as in append mode); the viewer's own title is not
    // used in-place (the asset title is), and its extra roles are merged into
    // the block badges.
    inplaceViewer() {
      if (this.definition) {
        return null;
      }
      const viewers = getViewersForAsset(this.asset, 'inplace');
      return viewers.length > 0 ? viewers[0] : null;
    },
    viewerIcon() {
      return this.inplaceViewer ? this.inplaceViewer.icon : null;
    },
    isImageViewerIcon() {
      return isImageIcon(this.viewerIcon);
    },
    viewerRoles() {
      return this.inplaceViewer && Array.isArray(this.inplaceViewer.roles) ? this.inplaceViewer.roles : [];
    },
    mainTabId() {
      return `${this.uid}-main`;
    },
    alternatives() {
      if (!isObject(this.asset.alternate)) {
        return {};
      }

      const alternates = {};
      for (const key in this.asset.alternate) {
        alternates[key] = this.asset.alternate[key].fillAlternate();
      }
      
      return alternates;
    },
    hasAlternatives() {
      return size(this.alternatives) > 0;
    },
    preferredTabId() {
      if (!this.hasAlternatives) {
        return this.mainTabId;
      }

      if (!this.preferredAssets) {
        return this.mainTabId;
      }

      // If preferredAssets is a string, it's the key of the preferred asset
      if (typeof this.preferredAssets === 'string') {
        if (this.preferredAssets === this.asset.getKey()) {
          return this.mainTabId;
        }
        if (Object.prototype.hasOwnProperty.call(this.alternatives, this.preferredAssets)) {
          return this.getAlternativeTabId(this.preferredAssets);
        }
      }

      // If preferredAssets is true, prefer HTTP(S) assets
      if (this.preferredAssets === true) {
        // Main asset has priority over alternatives
        if (this.asset.isHTTP) {
          return this.mainTabId;
        }
        
        // Find first HTTP(S) alternative
        const alternativeKeys = Object.keys(this.alternatives);
        for (let i = 0; i < alternativeKeys.length; i++) {
          const key = alternativeKeys[i];
          if (this.alternatives[key].isHTTP) {
            return this.getAlternativeTabId(key);
          }
        }
      }

      return this.mainTabId;
    }
  },
  watch: {
    preferredTabId: {
      immediate: true,
      handler(tabId) {
        this.activeTab = tabId;
      }
    }
  },
  created() {
    if (this.stateQueryParameters[this.type].indexOf(this.uid) > -1) {
      this.expanded = true;
      return;
    }

    if (typeof this.expand === 'boolean') {
      this.expanded = this.expand;
    }
    else {
      this.expanded = false;
    }
  },
  methods: {
    getAlternativeTabId(key) {
      return `${this.uid}-alt-${String(key).toLowerCase().replace(/[^\w]/g, '-')}`;
    },
    collapseToggled(isVisible) {
      let event = isVisible ? 'openCollapsible' : 'closeCollapsible';
      this.$store.commit(event, {type: this.type, uid: this.uid});
    },
    show() {
      this.$emit('show', ...arguments);
    }
  }
};
</script>

<style lang="scss">
#stac-browser .asset {
  .asset-body {
    padding: 0;
  }

  .asset-viewer-icon {
    width: 1.1rem;
    height: 1.1rem;
    line-height: 1.1rem;
    text-align: center;
    display: inline-block;
    flex: 0 0 auto;
    margin-right: 0.25rem;
  }

  .metadata {
    .card-columns {
      column-count: 1;
    }
    .card {
      border: 0;
    }
  }
}
</style>
