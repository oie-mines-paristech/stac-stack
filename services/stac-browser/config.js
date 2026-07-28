const TITLE = "Copernicus Data Space Ecosystem (CDSE) - STAC API";
module.exports = {
    catalogUrl: "https://stac.dataspace.copernicus.eu/v1/",
    catalogTitle: TITLE,
    catalogImage: "https://dataspace.copernicus.eu/themes/custom/copernicus/logo.svg",
    allowExternalAccess: false,
    allowedDomains: [
      "copernicus.eu"
    ],
    detectLocaleFromBrowser: true,
    storeLocale: true,
    locale: "en",
    fallbackLocale: "en",
    supportedLocales: [
        "de",
        "es",
        "en",
        "fr",
        "it",
        "ro",
        "pt",
        "pl"
    ],
    apiCatalogPriority: null,
    useTileLayerAsFallback: false,
    displayGeoTiffByDefault: false,
    displayPreview: true,
    displayOverview: true,
    buildTileUrlTemplate: null,
    getMapSourceOptions: null,
    pathPrefix: "/",
    historyMode: "history",
    cardViewMode: "cards",
    cardViewSort: "asc",
    showKeywordsInItemCards: false,
    showKeywordsInCatalogCards: false,
    showThumbnailsAsAssets: false,
    searchResultsPerPage: null,
    itemsPerPage: null,
    collectionsPerPage: null,
    maxEntriesPerPage: 1000,
    defaultThumbnailSize: null,
    crossOriginMedia: null,
    requestHeaders: {},
    requestQueryParameters: {},
    socialSharing: ['email', 'bsky', 'mastodon', 'x'],
    preprocessSTAC: stac => {
        if (stac.getBrowserPath() === '/') {
            stac.title = TITLE;
        }
        return stac;
    },
    authConfig: {
        type: "openIdConnect",
        openIdConnectUrl:"https://identity.dataspace.copernicus.eu/auth/realms/CDSE/.well-known/openid-configuration"
    },
    crs: {},
    footerLinks: null
};
