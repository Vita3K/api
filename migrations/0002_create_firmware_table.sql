-- Migration number: 0002 	 2026-10-04T14:37:21.530Z

DROP TABLE IF EXISTS `firmware`;

CREATE TABLE `firmware` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `response` TEXT DEFAULT NULL,
    PRIMARY KEY(`id`),
    CONSTRAINT `chk_single_row` CHECK (`id` = 1)
);
