<template>
  <b-card no-body :class="classes" v-visible.400="load" :img-placement="isList ? 'end' : undefined">
    <div class="card-img-wrapper">
      <AuthImage v-if="hasImage" class="thumbnail" v-bind="thumbnail" lazy />
    </div>
    <b-card-body>
      <b-card-title>
        <BIconLockFill v-if="requiresBasicAuth" class="auth-lock" aria-hidden="true" />
        <StacLink :data="[data, catalog]" class="stretched-link" />
      </b-card-title>
      <b-card-text v-if="fileFormats.length > 0 || hasDescription || isDeprecated" class="intro">
        <b-badge v-if="isDeprecated" variant="warning" class="me-1 mt-1 deprecated">{{ $t('deprecated') }}</b-badge>
        <b-badge v-for="format in fileFormats" :key="format" variant="secondary" class="me-1 mt-1 fileformat">{{ format }}</b-badge>
        {{ summarizeDescription }}
      </b-card-text>
      <Keywords v-if="showKeywordsInCatalogCards && keywords.length > 0" :keywords="keywords" variant="primary" />
      <b-card-text v-if="temporalExtent || itemCount !== null" class="datetime">
        <small v-if="temporalExtent" v-html="temporalExtent" />
        <small v-if="itemCount !== null">{{ $t('dataset', { count: itemCount }) }}</small>
      </b-card-text>
    </b-card-body>
    <b-card-footer>
      <slot name="footer" :data="data" :source="catalog">
        <StacActions v-if="data && !hideActions" :data="data" variant="outline-primary" compact size="sm" />
      </slot>
    </b-card-footer>
  </b-card>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import { mapState, mapGetters } from 'vuex';
import FileFormatsMixin from './FileFormatsMixin';
import StacFieldsMixin from './StacFieldsMixin';
import CardMixin from './CardMixin';
import StacLink from './StacLink.vue';
import StacActions from './StacActions.vue';
import { STAC } from 'stac-js';
import { formatTemporalExtent } from '@radiantearth/stac-fields/formatters';
import { formatMonthRange } from '../utils';
import { BCard, BCardBody, BCardFooter, BCardText, BCardTitle } from 'bootstrap-vue-next';
import AuthImage from './AuthImage.vue';
import BIconLockFill from '~icons/bi/lock-fill';

export default {
  name: 'Catalog',
  components: {
    AuthImage,
    BCard,
    BCardBody,
    BCardFooter,
    BCardText,
    BCardTitle,
    BIconLockFill,
    StacLink,
    StacActions,
    Keywords: defineAsyncComponent(() => import('./Keywords.vue'))
  },
  mixins: [
    FileFormatsMixin,
    CardMixin,
    StacFieldsMixin({ formatTemporalExtent })
  ],
  props: {
    catalog: {
      type: Object,
      required: true
    },
    // Hides the default StacActions in the footer slot, for embeddings
    // where showing them would be redundant or confusing (e.g. the parent
    // collection preview shown alongside an item's own actions).
    hideActions: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    ...mapState(['showKeywordsInCatalogCards']),
    ...mapGetters(['getStac']),
    classes() {
      let classes = ['catalog-card'];
      if (!this.data) {
        classes.push('queued');
      }
      if (this.data && this.data.deprecated) {
        classes.push('deprecated');
      }
      if (this.hasImage) {
        classes.push('has-thumbnail');
      }
      return classes;
    },
    data() {
      return this.getStac(this.catalog);
    },
    temporalExtent() {
      if (this.data?.isCollection && this.data.extent?.temporal?.interval.length > 0) {
        let extent = this.data.extent.temporal.interval[0];
        if (Array.isArray(extent) && (typeof extent[0] === 'string' || typeof extent[1] === 'string')) {
          // Compact `YYYY-MM → YYYY-MM` when bounded; otherwise let the
          // localized formatter word the open end.
          return formatMonthRange(extent[0], extent[1])
            ?? this.formatTemporalExtent(extent, true);
        }
      }
      return null;
    },
    itemCount() {
      if (!this.data?.isCollection || typeof this.data.getItemLinks !== 'function') {
        return null;
      }
      return this.data.getItemLinks().length;
    },
    requiresBasicAuth() {
      const obj = this.data || this.catalog;
      if (!obj) {
        return false;
      }
      const schemes = typeof obj.getMetadata === 'function'
        ? obj.getMetadata('auth:schemes')
        : obj['auth:schemes'];
      return Boolean(schemes && schemes.basic);
    }
  },
  methods: {
    load(visible) {
      if (this.catalog instanceof STAC) {
        return;
      }
      this.$store.commit(visible ? 'queue' : 'unqueue', this.catalog.getAbsoluteUrl());
    }
  }
};
</script>

<style lang="scss" scoped>
.auth-lock {
  margin-right: 0.35em;
  vertical-align: -0.125em;
}
</style>
