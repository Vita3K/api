-- Migration number: 0001 	 2026-10-02T22:36:38.333Z
DROP TABLE IF EXISTS `list`;
DROP TABLE IF EXISTS `list_info`;
DROP TRIGGER IF EXISTS `timestmap_update`;

CREATE TABLE `list_info` ( 
    `name` varchar(64) PRIMARY KEY NOT NULL, 
    `owner` varchar(64) NOT NULL, 
    `repo` varchar(64) NOT NULL, 
    `timestamp` INTEGER NOT NULL DEFAULT 0 
);

CREATE TABLE `list` (
    `type` varchar(64) NOT NULL,
    `name` varchar(1024) DEFAULT NULL,
    `titleId` varchar(10) DEFAULT NULL,
    `labels` TEXT DEFAULT NULL, -- JSON containing labels information
    `issueId` INTEGER NOT NULL,
    PRIMARY KEY(`type`, `issueId`),
    FOREIGN KEY(`type`) REFERENCES list_info(`name`)
);

CREATE TRIGGER `timestmap_update` AFTER INSERT
ON `list`
BEGIN
    UPDATE list_info SET timestamp = unixepoch() WHERE name = new.type;
END;

INSERT INTO `list_info` (`name`, `owner`, `repo`)
VALUES ('commercial', 'Vita3K', 'compatibility');
