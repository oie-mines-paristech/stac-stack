<template>
  <div class="asset-alternative">
    <HrefActions v-if="!hideActions" isAsset :data="asset" :shown="shown" @show="show" :auth="auth">
      <template #extra-actions>
        <AssetViewerActions
          v-for="(viewer, i) in actionViewers" :key="viewer.id"
          :viewer="viewer" :asset="asset" :separated="i === 0"
          @update:fullscreen="fullscreen[viewer.id] = $event"
        />
      </template>
    </HrefActions>
    <div v-else-if="actionViewers.length">
      <AssetViewerActions
        v-for="viewer in actionViewers" :key="viewer.id"
        :viewer="viewer" :asset="asset"
        @update:fullscreen="fullscreen[viewer.id] = $event"
      />
    </div>
    <div class="mt-4" v-if="description">
      <Description :description="description" compact />
    </div>
    <MetadataGroups class="mt-4" :data="resolvedAsset" :ignoreFields="ignoredMetadataFields" title="" type="Asset" />
    <AssetViewerFrame
      v-for="viewer in viewers" :key="viewer.id"
      :viewer="viewer" :asset="asset"
      :show-title="false"
      v-model:fullscreen="fullscreen[viewer.id]"
      class="mt-4"
    />
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import Description from './Description.vue';
import HrefActions from './HrefActions.vue';
import AuthUtils from './auth/utils';
import { isObject, size } from 'stac-js/src/utils.js';
import { Asset, STACReference } from 'stac-js';
import { getIgnoredFields } from '../ignored-metadata.js';
import AssetViewerFrame from '../oie/AssetViewerFrame.vue';
import AssetViewerActions from '../oie/AssetViewerActions.vue';
import { getViewersForAsset } from '../oie/assetViewers.js';

export default {
  name: 'AssetAlternative',
  components: {
    Description,
    HrefActions,
    AssetViewerFrame,
    AssetViewerActions,
    MetadataGroups: defineAsyncComponent(() => import('./MetadataGroups.vue'))
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
    shown: {
      type: Boolean,
      default: false
    }
  },
  emits: ['show'],
  data() {
    return {
      fullscreen: {}
    };
  },
  computed: {
    viewers() {
      return this.definition ? [] : getViewersForAsset(this.asset, 'inplace');
    },
    // Viewers whose own (iframe) buttons are kept.
    actionViewers() {
      return this.viewers.filter(viewer => viewer.hideViewerActions !== true);
    },
    // The asset's inherited action buttons are shared; the first in-place
    // viewer decides (mirrors how its icon/roles are used by Asset.vue).
    hideActions() {
      return this.viewers.length > 0 && this.viewers[0].hideActions === true;
    },
    description() {
      // Viewer override, else the asset description (default).
      const override = this.viewers.find(viewer => typeof viewer.description === 'string' && viewer.description);
      if (override) {
        return override.description;
      }
      return typeof this.asset.description === 'string' ? this.asset.description : '';
    },
    ignoredMetadataFields() {
      return getIgnoredFields(this.asset);
    },
    resolvedAsset() {
      if (Array.isArray(this.asset['storage:refs'])) {
        const asset = new Asset(this.asset);
        asset['storage:schemes'] = this.resolveStorage(this.asset);
        return asset;
      }
      return this.asset;
    },
    auth() {
      return AuthUtils.resolveAuth(this.asset);
    }
  },
  methods: {
    resolveStorage(obj) {
      if (obj instanceof STACReference) {
        const refs = obj.getMetadata('storage:refs');
        const schemes = obj.getMetadata('storage:schemes');
        if (size(refs) > 0 && size(schemes) > 0) {
          return refs
            .map(ref => schemes[ref])
            .filter(ref => isObject(ref));
        }
      }
      return [];
    },
    show() {
      this.$emit('show', ...arguments);
    }
  }
};
</script>

<style lang="scss" scoped>
.asset-alternative {
  padding: 1rem;
}
</style>
