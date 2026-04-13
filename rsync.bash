#!/usr/bin/bash
#rsync -r $@ ./dist/ insitu@stac:/var/www/stac.webservice-energy.org
rsync -r $@ ./dist/ /var/www/html
