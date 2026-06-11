# instruction folder to zarr

J'ai un répertoire statique qui contient des données géographique 
(des NetCDF, des Geotiff, des Zarrs).

Je voudrais générer automatiquement, avec python, un catalogue STAC avec le minimum de config possible :
- Récupérer toutes les métadonnées possibles depuis les assets (geotiff, netcdf, etc)
- Ajouter quelques métadonnée dans chaque répertoire avec un fichier metadata.yml

Ca se présente comme ça :
- catalog1
  - metadata.yml
  - thumbnail.{jpg,png}
  - asset1.pdf
  - collection1/
    - metadata.yml
    - img.geotiff
    - data.netcdf
    - data.zarr/
   	- ...
  - collection2/
    ...
  - subcatalog1/
      - metadata.yml
      - colelction3/ ...

etc...

## Metadonnées depuis les fichiers geographiques

Pour les items / features

- Extrait les métadonnées depuis les fichier gtiff, zarr et netcdf avec xarray / rasterio et rioxarray. Faits gaffe à ouvrir les fichiers juste pour récupérer les métadonnées, sans loader les donnéées elles même.
- Tu dois tenter de récupèrer à minima les extent spatial (bbox) et temoporel (optionel)
- Base toi sur les convention CF le plus possible
- Lis aussi métadonnée globales ACCL (https://wiki.esipfed.org/Attribute_Convention_for_Data_Discovery_1-3) et tente de les convertir dans les métadonnées stac coresdpondantes (genre license, title, id, description, auteur, doi, etc, ...)
- utilise et rempli si possible les extension STAC "datacube" et "eo" (earth observation)
- 

## metadata.yml

Le fichier metadata.yml défini le contenu d'une colelction ou d'un catalogue:

- id (optionnel, nom du path relatif au root par defaut)
- title (optionel, nom du dossier par défaut)
- description: description
- assets : list d'assets 
- children (pour Catalogue)
    - liste de sous catalog / sous collection
- items (pour collection)
    - liste d'items geographiques


### Children / items
- la présence de "children" ou "items" définit le type (catalogue ou collection respectivement) 
- "children" et "items" sont une liste de fichier relativement à ici, ou des glob pattern (relatif aussi)


### Assets 
-  les "assets" sont une liste soit : de nom de fichier, auquel cas le nom et et le role est le basename sans extension du fichier, ou bien un objet de ce type :
- file: asset.pdf
- roles: ["role1", "role2"]
- name: my-pdf
- mime: mime_type (optionel)

Par défaut, si présent, un asset thumbnail.{png; jpg} est ajouté.

Si manquant, le mime type est deviné par l'extension

## Exemples de metadata.yml
### metadata.yml pour une collection

```yml
id: collection1
title: A collection
description : this is a colelction
items: 
  - tiff-1.geotiff
  - *.nc
  - subfolder/*.zarr
```

### metadata.yml pour un catalog

```yml
id: catalog1
title: A catalog
description : This is a catalog
children: 
  - ./collection1
  - ./collection2
  - ./other-collections*/
```

## Layout du catalogue de sortie

Le catalogue de sortie devra respecter le layout d'entrée des catalogues / collections et adhérer au layout standard de stac : 
- catalog1/
  - catalog.json
  - collection1
    - collection.json
    - items/
      - item1.json
      - item2.json
  - collection2/
    - collection.json
  - subcatalog/
    - catalog.json 
    - ...

## HREFs
- Les href des liens (parent, enfant) seront touts relatifs à chaque fichier "json" généré
- Les hrefs des assets (vers des resources physiques, genre thumbnail, geotiff, pdf, etc) seront relatifs au ROOT_FOLDER auquel on ajoutera un prefix ROOT_HREF

Par exemple, imaginons quj'on ait :
ROOT_FOLDER = /home/me/data/
ROOT_HREF = http://site.tld/path/

Alors pour faire référence à "/home/me/data/collection1/img.png", ça donnera "http://site.tld/path/collection1/img.png"

## Interface cli

Le script aura une interface de type :
generate-stac.py --input <root-folder> --output <out-folder> --root_href "http://site.tld/path/"


## Autres instructions 
- utilise pystac 
- utilise pathlib pour gérer les dossier répertoire realtifs etc
- Utilise pydantic et definit les schema qui vont bien pour valider / parser metadata.yml
- Les extent spatial et temporel des colection doive,nt être calculées automatiquemùent comme union / extension des extents de leurs items 
- Cherche sur le net des exemples de catalogues / colelctions / items stac pour t'en inspirer

# Environment

Utilise le .venv ici, géré avec uv.