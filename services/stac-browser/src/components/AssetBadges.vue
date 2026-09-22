<template>
  <div class="badges ms-1">
    <b-badge v-if="shown" variant="success" class="shown" :title="$t('assets.currentlyShown')">
      <b-icon-check /> {{ $t('assets.shown') }}
    </b-badge>
    <b-badge v-if="asset.deprecated" variant="warning" class="deprecated">{{ $t('deprecated') }}</b-badge>
    <b-badge v-for="role in roles" :key="role" :variant="role === 'data' ? 'primary' : 'secondary'" class="role" :title="displayRole(role)">{{ displayRole(role) }}</b-badge>
    <b-badge v-if="shortFileFormat" variant="dark" class="format" :title="longFileFormat"><span v-html="shortFileFormat" /></b-badge>
  </div>
</template>

<script>
import { formatAssetMediaType } from '../oie/mediaType.js';

export default {
  name: 'AssetBadges',
  props: {
    asset: {
      type: Object,
      required: true
    },
    shown: {
      type: Boolean,
      default: false
    },
    // Extra roles contributed by a configured asset viewer, merged in after the
    // asset's own roles (deduplicated).
    extraRoles: {
      type: Array,
      default: () => ([])
    }
  },
  computed: {
    shortFileFormat() {
      if (typeof this.asset.type === "string" && this.asset.type.length > 0) {
        return formatAssetMediaType(this.asset.type, { shorten: true });
      }
      return null;
    },
    longFileFormat() {
      if (typeof this.asset.type === "string" && this.asset.type.length > 0) {
        return formatAssetMediaType(this.asset.type);
      }
      return null;
    },
    roles() {
      const assetRoles = Array.isArray(this.asset.roles) ? this.asset.roles : [];
      // Sort roles with 'data' first, then alphabetically (case-insensitive)
      const sorted = [...assetRoles].sort((a, b) => {
        if (a === 'data') {
          return -1;
        }
        if (b === 'data') {
          return 1;
        }
        return a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { sensitivity: 'base' });
      });
      const seen = new Set(assetRoles.map(role => String(role).toLowerCase()));
      // The media type is already shown as its own tag: don't add a same-named
      // viewer role (e.g. "notebook" for the "Notebook" media type).
      if (this.shortFileFormat) {
        seen.add(String(this.shortFileFormat).toLowerCase());
      }
      const extra = [];
      for (const role of this.extraRoles) {
        const key = String(role).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          extra.push(role);
        }
      }
      return [...sorted, ...extra];
    }
  },
  methods: {
    displayRole(role) {
      let key = `assets.role.${role}`;
      if (this.$te(key)) {
        return this.$t(key);
      }
      return role;
    }
  }
};
</script>