.PHONY: run watch test

run:
	./main.py --input data/in/ --output data/catalog/ --root-href "/root"

watch:
	./main.py --input data/in/ --output data/catalog/ --watch --root-href "/root"

test:
	uv run pytest tests/e2e -v
