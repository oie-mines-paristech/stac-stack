<template>
  <b-button
    v-if="src"
    variant="primary" class="asset-viewer-action"
    :class="{ 'ms-2': separated }"
    :title="$t('fullscreen.show')"
    @click="$emit('update:fullscreen', true)"
  >
    <b-icon-fullscreen class="me-1" />
    {{ $t('assetViewer.fullscreen') }}
  </b-button>
  <b-button
    v-if="src"
    variant="primary" class="asset-viewer-action"
    tag="a" :href="src" target="_blank" rel="noopener noreferrer"
    :title="$t('assetViewer.openInNewTab')"
  >
    <b-icon-box-arrow-up-right class="me-1" />
    {{ $t('assetViewer.openInNewTab') }}
  </b-button>
</template>

<script>
import { mapGetters } from 'vuex';
import { buildViewerUrl } from './assetViewers.js';

export default {
  name: 'AssetViewerActions',
  props: {
    viewer: {
      type: Object,
      required: true
    },
    asset: {
      type: Object,
      required: true
    },
    // Add a small gap before the first button (in-place mode, to separate the
    // viewer buttons from the asset's own action buttons in the same group).
    separated: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:fullscreen'],
  computed: {
    ...mapGetters(['getRequestUrl']),
    src() {
      if (!this.viewer.url || typeof this.asset.href !== 'string') {
        return null;
      }
      return buildViewerUrl(this.viewer, this.asset, this.getRequestUrl);
    }
  }
};
</script>

<style lang="scss">
#stac-browser .asset-viewer-action {
  line-height: 1;
}
</style>