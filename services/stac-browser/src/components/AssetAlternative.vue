<template>
  <div class="asset-alternative">
    <HrefActions isAsset :data="asset" :shown="shown" @show="show" :auth="auth">
      <template #extra-actions>
        <AssetViewerActions
          v-for="(viewer, i) in viewers" :key="viewer.id"
          :viewer="viewer" :asset="asset" :separated="i === 0"
          @update:fullscreen="fullscreen[viewer.id] = $event"
        />
      </template>
    </HrefActions>
    <div class="mt-4" v-if="asset.description">
      <Description :description="asset.description" compact />
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
