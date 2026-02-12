from django.urls import path

from core.views import (
    cost_code_detail_view,
    cost_codes_list_create_view,
    convert_lead_to_project_view,
    estimate_clone_version_view,
    estimate_detail_view,
    estimate_status_events_view,
    health_view,
    login_view,
    me_view,
    project_estimates_view,
    project_detail_view,
    projects_list_view,
    quick_add_lead_contact_view,
)

urlpatterns = [
    path("health/", health_view, name="health"),
    path("auth/login/", login_view, name="auth-login"),
    path("auth/me/", me_view, name="auth-me"),
    path("lead-contacts/quick-add/", quick_add_lead_contact_view, name="lead-contact-quick-add"),
    path(
        "lead-contacts/<int:lead_id>/convert-to-project/",
        convert_lead_to_project_view,
        name="lead-contact-convert-to-project",
    ),
    path("projects/", projects_list_view, name="projects-list"),
    path("projects/<int:project_id>/", project_detail_view, name="project-detail"),
    path(
        "projects/<int:project_id>/estimates/",
        project_estimates_view,
        name="project-estimates",
    ),
    path("estimates/<int:estimate_id>/", estimate_detail_view, name="estimate-detail"),
    path(
        "estimates/<int:estimate_id>/status-events/",
        estimate_status_events_view,
        name="estimate-status-events",
    ),
    path(
        "estimates/<int:estimate_id>/clone-version/",
        estimate_clone_version_view,
        name="estimate-clone-version",
    ),
    path("cost-codes/", cost_codes_list_create_view, name="cost-codes-list-create"),
    path("cost-codes/<int:cost_code_id>/", cost_code_detail_view, name="cost-codes-detail"),
]
