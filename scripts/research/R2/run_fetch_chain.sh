#!/bin/bash
# sequential licence-clean fetches (Openverse is limited to 20 req/min, 200/day anonymous)
cd /home/user/special-telegram/scripts/research/R2
python3 -I fetch_clean.py /home/user/special-telegram/references/food/_raw/clean /home/user/special-telegram/scripts/research/R2/topics_food.json >> /home/user/special-telegram/references/food/_raw/fetch_clean.out 2>&1
python3 -I fetch_clean.py /home/user/special-telegram/references/food/_raw/labelart /home/user/special-telegram/scripts/research/R2/topics_labelart.json >> /home/user/special-telegram/references/food/_raw/fetch_labelart.out 2>&1
