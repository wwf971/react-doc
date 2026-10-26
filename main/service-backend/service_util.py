"""Ids, times, names and yaml files, kept in the forms the asset store uses."""

import os
import random
import re
import tempfile
import time

import yaml

# the separator of a template folder name {templateId}--{name}, as for asset objects
TEMPLATE_DIR_SEPARATOR = '--'
# the separator of an instance folder name {templateName}-inst-{serviceId}
INSTANCE_DIR_SEPARATOR = '-inst-'
NAME_LENGTH_MAX = 80
REGEX_ID = re.compile(r'^[0-9a-z]+$')
# a template name is also the middle of a dashboard's component id
# (service/{templateName}/{dashboardId}), so it is kept to what an id may hold
REGEX_TEMPLATE_NAME = re.compile(r'^[a-z0-9][a-z0-9_-]*$')
_BASE36_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'


def id_ms48_create(is_used=None):
    """An id of the form ms48: (unix ms << 16 | 16 random bits) in base 36.

    The same form as asset object ids (plugin/id-ms48.ts), so a service
    folder looks like an object folder and sorts by creation.
    """
    while True:
        value = (int(time.time() * 1000) << 16) | random.randrange(1 << 16)
        text = ''
        while value > 0:
            value, digit = divmod(value, 36)
            text = _BASE36_DIGITS[digit] + text
        if is_used is None or not is_used(text):
            return text


def time_text_get():
    """20260520_23250530+09: local time to 10 ms, then the zone offset in whole hours."""
    now = time.time()
    local = time.localtime(now)
    centisecond = int((now % 1) * 100)
    zone_hours = round(local.tm_gmtoff / 3600)
    zone_text = f'{"-" if zone_hours < 0 else "+"}{abs(zone_hours):02d}'
    return time.strftime('%Y%m%d_%H%M%S', local) + f'{centisecond:02d}' + zone_text


def time_iso_get():
    """2026-10-29T12:34:56.789+09:00: the time of a log record, sortable as text."""
    now = time.time()
    local = time.localtime(now)
    millisecond = int((now % 1) * 1000)
    zone_minute = round(local.tm_gmtoff / 60)
    zone_text = f'{"-" if zone_minute < 0 else "+"}{abs(zone_minute) // 60:02d}:{abs(zone_minute) % 60:02d}'
    return time.strftime('%Y-%m-%dT%H:%M:%S', local) + f'.{millisecond:03d}' + zone_text


def instance_name_normalize(name_input):
    """The name of an instance: a label kept in its service.yaml, not in its folder name.

    Raises ValueError with the reason.
    """
    name = str(name_input or '').strip()
    if name == '':
        raise ValueError('the name is empty')
    if len(name) > NAME_LENGTH_MAX:
        raise ValueError(f'the name is longer than {NAME_LENGTH_MAX} characters')
    if re.search(r'[\x00-\x1f]', name):
        raise ValueError('the name cannot contain control characters')
    return name


def template_name_check(name):
    """The reason a template name cannot be used, '' when it can."""
    if not isinstance(name, str) or name == '':
        return 'the template name is empty'
    if len(name) > NAME_LENGTH_MAX:
        return f'the template name is longer than {NAME_LENGTH_MAX} characters'
    if not REGEX_TEMPLATE_NAME.match(name):
        return 'a template name is lowercase letters, digits, - and _, starting with a letter or a digit'
    if TEMPLATE_DIR_SEPARATOR in name:
        return f'a template name cannot contain "{TEMPLATE_DIR_SEPARATOR}"'
    return ''


def template_dir_name_split(dir_name):
    """(templateId, name) of a template folder name, or None when it is not {id}--{name}."""
    if TEMPLATE_DIR_SEPARATOR not in dir_name:
        return None
    template_id, name = dir_name.split(TEMPLATE_DIR_SEPARATOR, 1)
    if not REGEX_ID.match(template_id) or template_name_check(name) != '':
        return None
    return template_id, name


def instance_dir_name_build(template_name, service_id):
    return f'{template_name}{INSTANCE_DIR_SEPARATOR}{service_id}'


def instance_dir_name_split(dir_name):
    """(templateName, serviceId) of an instance folder name, or None when it is not
    {templateName}-inst-{serviceId}. An id never holds a '-', so the id is what
    follows the last separator."""
    if INSTANCE_DIR_SEPARATOR not in dir_name:
        return None
    template_name, service_id = dir_name.rsplit(INSTANCE_DIR_SEPARATOR, 1)
    if template_name == '' or not REGEX_ID.match(service_id):
        return None
    return template_name, service_id


def yaml_read(path):
    with open(path, 'r', encoding='utf-8') as file:
        return yaml.safe_load(file)


def yaml_write(path, value):
    """Writes through a temporary file, so a reader never sees half a file."""
    text = yaml.safe_dump(value, allow_unicode=True, sort_keys=False)
    dir_path = os.path.dirname(path)
    file_descriptor, path_temp = tempfile.mkstemp(dir=dir_path, prefix='.tmp-', suffix='.yaml')
    try:
        with os.fdopen(file_descriptor, 'w', encoding='utf-8') as file:
            file.write(text)
        os.replace(path_temp, path)
    except BaseException:
        if os.path.exists(path_temp):
            os.remove(path_temp)
        raise


def yaml_write_commented(path, value, comment_text):
    """yaml_write with a comment block on top (the file the kernel writes for
    itself, so a reader of the disk knows what it is)."""
    text = yaml.safe_dump(value, allow_unicode=True, sort_keys=False)
    comment = ''.join(f'# {line}\n' if line else '#\n' for line in comment_text.strip('\n').split('\n'))
    dir_path = os.path.dirname(path)
    file_descriptor, path_temp = tempfile.mkstemp(dir=dir_path, prefix='.tmp-', suffix='.yaml')
    try:
        with os.fdopen(file_descriptor, 'w', encoding='utf-8') as file:
            file.write(comment + text)
        os.replace(path_temp, path)
    except BaseException:
        if os.path.exists(path_temp):
            os.remove(path_temp)
        raise
