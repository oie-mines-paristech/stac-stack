<template>
  <b-form-group :label="label" :label-for="id">
    <b-input-group size="sm">
      <b-form-input :id="id" ref="input" :value="resolvedUrl" readonly />
      <b-input-group-append>
        <CopyButton :copyText="resolvedUrl" variant="primary" />
        <b-button v-if="open" :href="resolvedUrl" target="_blank" variant="primary" :title="$t('open')"><b-icon-arrow-up-right-square /></b-button>
      </b-input-group-append>
    </b-input-group>
  </b-form-group>
</template>

<script>
import {
  BFormInput, BFormGroup,
  BIconArrowUpRightSquare,
  BInputGroup, BInputGroupAppend } from 'bootstrap-vue';
import { mapGetters } from 'vuex';

export default {
  name: "Url",
  components: {
    BFormGroup,
    BFormInput,
    BIconArrowUpRightSquare,
    BInputGroup,
    BInputGroupAppend,
    CopyButton: () => import('./CopyButton.vue')
  },
  props: {
    id: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    open: {
      type: Boolean,
      default: true
    }
  },
  computed: {
    ...mapGetters(['getShareableUrl']),
    resolvedUrl() {
      return this.getShareableUrl(this.url);
    }
  }
};
</script>

<style lang="scss" scoped>
.popover {
  width: 100%;
  max-width: 800px;
}
</style>
