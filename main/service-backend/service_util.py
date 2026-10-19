"""Ids, times, names and yaml files, kept in the forms the asset store uses."""

import os
import random
import re
import tempfile
import time

import yaml

# the separator of a folder name {serviceId}--{name}, as for asset objects
DIR_SEPARATOR = '--'
NAME_LENGTH_MAX = 80
REGEX_ID = re.compile(r'^[0-9a-z]+$')
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


def name_normalize(name_input):
    """A name for a folder {serviceId}--{name}: the rules of asset object names.

    Raises ValueError with the reason.
    """
    name = str(name_input or '').strip()
    if name == '':
        raise ValueError('the name is empty')
    if len(name) > NAME_LENGTH_MAX:
        raise ValueError(f'the name is longer than {NAME_LENGTH_MAX} characters')
    if DIR_SEPARATOR in name:
        raise ValueError(f'the name cannot contain "{DIR_SEPARATOR}"')
    if re.search(r'[/\\:*?"<>|\x00-\x1f]', name):
        raise ValueError('the name cannot contain / \\ : * ? " < > | or control characters')
    if name.endswith('.'):
        raise ValueError('the name cannot end with a dot')
    return name


def dir_name_split(dir_name):
    """(serviceId, name) of a folder name, or None when it is not {id}--{name}."""
    if DIR_SEPARATOR not in dir_name:
        return None
    service_id, name = dir_name.split(DIR_SEPARATOR, 1)
    if not REGEX_ID.match(service_id) or name == '':
        return None
    return service_id, name


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
