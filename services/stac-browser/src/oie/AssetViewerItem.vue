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
    </template>
    <AssetViewerFrame :viewer="viewer" :asset="asset" :show-title="false" />
  </b-accordion-item>
</template>

<script>
import { BAccordionItem } from 'bootstrap-vue-next';
import AssetViewerFrame from './AssetViewerFrame.vue';
import { isImageIcon } from './assetViewers.js';

export default {
  name: 'AssetViewerItem',
  components: {
    AssetViewerFrame,
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
    }
  },
  data() {
    return {
      expanded: false
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