<template>
  <b-accordion-item
    :id="uid"
    v-model="expanded"
    class="asset asset-viewer-item"
    body-class="asset-viewer-item-body"
    @update:model-value="collapseToggled"
  >
    <template #title>
      <span class="start">
        <span class="chevron" aria-hidden="true">
          <b-icon-chevron-down v-if="expanded" />
          <b-icon-chevron-right v-else />
        </span>
        <img
          v-if="isImageIcon"
          :src="viewer.icon"
          alt=""
          class="asset-viewer-item-icon img-fluid"
        >
        <span v-else class="asset-viewer-item-icon">{{ viewer.icon }}</span>
        <span class="title">{{ viewer.title }}</span>
      </span>
      <AssetBadges :asset="asset" :shown="shown" :extra-roles="viewerRoles" />
    </template>
    <HrefActions
      v-if="!viewer.hideActions" isAsset :data="asset" :shown="shown"
      @show="show" :auth="auth"
      class="mb-3"
    >
      <template #extra-actions>
        <AssetViewerActions
          v-if="!viewer.hideViewerActions"
          :viewer="viewer" :asset="asset" :separated="true"
          @update:fullscreen="fullscreen = $event"
        />
      </template>
    </HrefActions>
    <AssetViewerActions
      v-else-if="!viewer.hideViewerActions"
      :viewer="viewer" :asset="asset" class="mb-3"
      @update:fullscreen="fullscreen = $event"
    />
    <div v-if="description" class="mb-3">
      <Description :description="description" compact />
    </div>
    <AssetViewerFrame
      :viewer="viewer" :asset="asset" :show-title="false"
      v-model:fullscreen="fullscreen"
    />
  </b-accordion-item>
</template>

<script>
import { BAccordionItem } from 'bootstrap-vue-next';
import AssetBadges from '../components/AssetBadges.vue';
import AssetViewerFrame from './AssetViewerFrame.vue';
import AssetViewerActions from './AssetViewerActions.vue';
import Description from '../components/Description.vue';
import HrefActions from '../components/HrefActions.vue';
import AuthUtils from '../components/auth/utils';
import { isImageIcon } from './assetViewers.js';

export default {
  name: 'AssetViewerItem',
  components: {
    AssetBadges,
    AssetViewerFrame,
    AssetViewerActions,
    Description,
    HrefActions,
    BAccordionItem
  },
  props: {
    viewer: {
      type: Object,
      required: true
    },
    asset: {
      type: Object,
      required: true
    },
    expand: {
      type: Boolean,
      default: false
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
      fullscreen: false
    };
  },
  computed: {
    type() {
      return 'asset';
    },
    uid() {
      const key = typeof this.asset.getKey === 'function' ? this.asset.getKey() : '';
      return `asset-viewer-${String(this.viewer.id).toLowerCase().replace(/[^\w]/g, '-')}-${String(key).toLowerCase().replace(/[^\w]/g, '-')}`;
    },
    isImageIcon() {
      return isImageIcon(this.viewer.icon);
    },
    viewerRoles() {
      return Array.isArray(this.viewer.roles) ? this.viewer.roles : [];
    },
    auth() {
      return AuthUtils.resolveAuth(this.asset);
    },
    description() {
      // Viewer override, else the asset description (default).
      if (typeof this.viewer.description === 'string' && this.viewer.description) {
        return this.viewer.description;
      }
      return typeof this.asset.description === 'string' ? this.asset.description : '';
    }
  },
  created() {
    if (this.$store.state.stateQueryParameters[this.type].indexOf(this.uid) > -1) {
      this.expanded = true;
      return;
    }
    this.expanded = this.expand;
  },
  methods: {
    collapseToggled(isVisible) {
      const event = isVisible ? 'openCollapsible' : 'closeCollapsible';
      this.$store.commit(event, { type: this.type, uid: this.uid });
    },
    show() {
      this.$emit('show', ...arguments);
    }
  }
};
</script>

<style lang="scss">
#stac-browser .asset-viewer-item {
  .asset-viewer-item-body {
    padding: 1rem;
  }

  .asset-viewer-item-icon {
    width: 1.1rem;
    height: 1.1rem;
    line-height: 1.1rem;
    text-align: center;
    display: inline-block;
    flex: 0 0 auto;
    margin-right: 0.25rem;
  }
}
</style>